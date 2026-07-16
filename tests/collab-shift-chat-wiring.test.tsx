/**
 * @vitest-environment happy-dom
 *
 * R-RTC-1.2 card SC — shift-chat collaboration wiring (Feature 1).
 *
 * The collab channel is EPHEMERAL + ADVISORY. It carries typing + presence and a
 * lightweight "new message" nudge only — REST-persist + SSE stays the source of
 * truth for message content. These lock the wiring contract:
 *
 *   1. A peer `peer-typing` event surfaces that peer (→ the panel typing
 *      indicator), with the displayName resolved from server-attached presence.
 *   2. A `chat-nudge` triggers the EXISTING refetch, COALESCED by messageId so
 *      duplicate nudges + reconnect replays cause AT MOST ONE refetch per new
 *      message.
 *   3. With the socket unavailable (no token → getCollabSocket returns null) the
 *      panel still fully works via the REST-poll presence path and message
 *      send/receive is NEVER gated on the socket.
 *   4. The client NEVER sends its own userId — the server attaches identity from
 *      the DB session; `typing` carries only the on-flag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";

// ── Fake socket.io-client (reuse the real collab-socket primitive) ────────────
interface FakeSocket {
  connected: boolean;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  handlers: Map<string, (payload?: unknown) => void>;
  trigger: (event: string, payload?: unknown) => void;
}

const fakeSockets: FakeSocket[] = [];

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const s: FakeSocket = {
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
      return s;
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
      return s;
    }),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => handlers.clear()),
    handlers,
    trigger: (event, payload) => {
      const h = handlers.get(event);
      if (h) h(payload);
    },
  };
  return s;
}

const ioMock = vi.fn((..._args: unknown[]) => {
  const s = makeFakeSocket();
  fakeSockets.push(s);
  return s;
});

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

vi.mock("@/lib/api-origin", () => ({
  needsRemoteApiOrigin: () => false,
  getConfiguredApiOrigin: () => null,
  resolveApiUrl: (p: string) => p,
}));

// The panel pulls identity/experience — mock like the other shift-chat panel tests.
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "me" }) }));
vi.mock("@/hooks/use-experience", () => ({ useExperience: () => ({ can: () => true }) }));

import { setAuthState } from "@/lib/auth-store";
import { closeCollabSocket } from "@/lib/collab-socket";
import { useShiftChatCollab } from "@/features/shift-chat/hooks/useShiftChatCollab";
import { ShiftChatPanel } from "@/features/shift-chat/components/ShiftChatPanel";
import { t } from "@/lib/i18n";

const JWT = "aaa.bbb.ccc"; // isLikelyJwt: three non-empty dot-parts

function seedToken(token: string | null) {
  setAuthState({ userId: "me", email: "", name: "", bearerToken: token });
}

/** Resolve the ack callback the hook passed to the `join` emit and accept it. */
function acceptJoin(socket: FakeSocket, members: { userId: string; displayName: string }[]) {
  const joinCall = socket.emit.mock.calls.find((c) => c[0] === "join");
  const ack = joinCall?.[2] as ((r: unknown) => void) | undefined;
  ack?.({ ok: true, room: "clinic:c1:chat", members });
}

afterEach(() => {
  cleanup();
  closeCollabSocket();
  ioMock.mockClear();
  fakeSockets.length = 0;
  seedToken(null);
});

describe("useShiftChatCollab — Feature 1 wiring (R-RTC-1.2)", () => {
  it("surfaces a peer's typing (name from server-attached presence)", () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useShiftChatCollab({ enabled: true, onNewMessage: vi.fn() }),
    );
    const socket = fakeSockets[0]!;

    act(() =>
      socket.trigger("presence", {
        room: "clinic:c1:chat",
        members: [{ userId: "peer-1", displayName: "Dana" }],
      }),
    );
    act(() => socket.trigger("peer-typing", { userId: "peer-1", on: true }));

    expect(result.current.peerTypingUserIds).toContain("peer-1");
    expect(result.current.presentMembers).toEqual([{ userId: "peer-1", displayName: "Dana" }]);

    // A subsequent off clears it.
    act(() => socket.trigger("peer-typing", { userId: "peer-1", on: false }));
    expect(result.current.peerTypingUserIds).not.toContain("peer-1");
  });

  it("coalesces duplicate nudges + reconnect replays into ONE refetch per messageId", () => {
    seedToken(JWT);
    const onNewMessage = vi.fn();
    renderHook(() => useShiftChatCollab({ enabled: true, onNewMessage }));
    const socket = fakeSockets[0]!;

    act(() => {
      socket.trigger("chat-nudge", { messageId: "m-9" });
      socket.trigger("chat-nudge", { messageId: "m-9" }); // duplicate
      socket.trigger("chat-nudge", { messageId: "m-9" }); // reconnect replay
    });
    expect(onNewMessage).toHaveBeenCalledTimes(1);

    act(() => socket.trigger("chat-nudge", { messageId: "m-10" })); // genuinely new
    expect(onNewMessage).toHaveBeenCalledTimes(2);
  });

  it("emits `typing` with the on-flag ONLY — never a client-supplied userId", () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useShiftChatCollab({ enabled: true, onNewMessage: vi.fn() }),
    );
    const socket = fakeSockets[0]!;
    acceptJoin(socket, []);

    act(() => result.current.notifyTyping());

    const typingCall = socket.emit.mock.calls.find((c) => c[0] === "typing");
    expect(typingCall).toBeTruthy();
    expect(typingCall![1]).toEqual({ on: true });
    expect(typingCall![1]).not.toHaveProperty("userId");
  });

  it("degrades with NO token: no socket is created and the hook stays inert", () => {
    seedToken(null);
    const onNewMessage = vi.fn();
    const { result } = renderHook(() =>
      useShiftChatCollab({ enabled: true, onNewMessage }),
    );

    expect(ioMock).not.toHaveBeenCalled();
    expect(fakeSockets).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    // notifyTyping is a no-op when the socket is unavailable — never throws.
    act(() => result.current.notifyTyping());
    expect(onNewMessage).not.toHaveBeenCalled();
  });
});

describe("ShiftChatPanel — collab typing/presence render + degradation", () => {
  const baseChat: ComponentProps<typeof ShiftChatPanel>["chat"] = {
    sendMessage: vi.fn(),
    isSending: false,
    notifyTyping: vi.fn(),
    ackMessage: vi.fn(),
    reactToMessage: vi.fn(),
    pinMessage: vi.fn(),
    isLoading: false,
    messages: [],
    onlineUserIds: [],
    pinnedMessage: null,
    typing: [],
  };

  it("renders a peer typing indicator + presence count from collab state", () => {
    const collab = {
      isConnected: true,
      peerTypingUserIds: ["peer-1"],
      presentMembers: [{ userId: "peer-1", displayName: "Dana" }],
      notifyTyping: vi.fn(),
    };
    render(<ShiftChatPanel isOpen onClose={() => {}} chat={baseChat} collab={collab} />);

    // getByText throws if absent, so a returned element is the assertion.
    expect(screen.getByText(t.shiftChat.panel.typing("Dana"))).toBeTruthy();
    expect(screen.getByText(t.shiftChat.panel.onlineCount(1))).toBeTruthy();
  });

  it("with the socket unavailable, the panel loads via REST presence and message send is unaffected", () => {
    const sendMessage = vi.fn();
    const chat = { ...baseChat, sendMessage, onlineUserIds: ["a", "b", "c"] };
    // No `collab` prop → the socket path is entirely absent (degraded).
    render(<ShiftChatPanel isOpen onClose={() => {}} chat={chat} />);

    // REST-poll presence still renders.
    expect(screen.getByText(t.shiftChat.panel.onlineCount(3))).toBeTruthy();

    // Message flow is NEVER gated on the socket.
    const textarea = screen.getByPlaceholderText(t.shiftChat.panel.placeholder);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
