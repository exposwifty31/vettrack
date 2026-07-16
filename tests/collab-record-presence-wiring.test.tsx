/**
 * @vitest-environment happy-dom
 *
 * R-RTC-1.4 card RC — record co-presence wiring (Feature 3).
 *
 * The collab channel is EPHEMERAL + STRICTLY ADVISORY. On a record detail it
 * carries only "who is viewing / editing this record" — it NEVER locks, blocks,
 * or alters an edit. The server OCC/version guard stays the SOLE conflict
 * authority. These lock the wiring contract:
 *
 *   1. A peer `peer-record` editing event surfaces that peer as an editor, with
 *      the displayName resolved from server-attached presence → the advisory
 *      indicator renders "<name> is editing this".
 *   2. The client emits `record-presence` with the INTENT ONLY ({ editing }) —
 *      never a client-supplied recordId/recordType (the join room is the trusted
 *      binding) and never a userId (the server attaches identity from the DB
 *      session). Mount → viewing; entering an edit → editing.
 *   3. Co-presence is purely advisory: the indicator is non-interactive (no
 *      button/input) — it can never gate an edit. The OCC guard alone decides
 *      conflicts.
 *   4. With the socket unavailable (no token → getCollabSocket returns null) the
 *      hook is inert (no indicator) and the detail edit flow is unaffected.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

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

import { setAuthState } from "@/lib/auth-store";
import { setClerkTokenGetter } from "@/lib/auth-fetch";
import { closeCollabSocket } from "@/lib/collab-socket";
import { useRecordPresence } from "@/features/collab/useRecordPresence";
import { RecordPresenceIndicator } from "@/features/collab/RecordPresenceIndicator";
import { t } from "@/lib/i18n";

const JWT = "aaa.bbb.ccc"; // isLikelyJwt: three non-empty dot-parts
const ROOM = "clinic:c1:record:equipment:eq-1";

function seedToken(token: string | null) {
  setAuthState({ userId: "me", email: "", name: "", bearerToken: token });
}

/** Flush the async fresh-token mint → connect, then assert the socket exists. */
async function connectedSocket(): Promise<FakeSocket> {
  await waitFor(() => expect(fakeSockets).toHaveLength(1));
  return fakeSockets[0]!;
}

/** Resolve the ack callback the hook passed to the `join` emit and accept it. */
function acceptJoin(socket: FakeSocket, members: { userId: string; displayName: string }[]) {
  const joinCall = socket.emit.mock.calls.find((c) => c[0] === "join");
  const ack = joinCall?.[2] as ((r: unknown) => void) | undefined;
  ack?.({ ok: true, room: ROOM, members });
}

afterEach(() => {
  cleanup();
  closeCollabSocket();
  setClerkTokenGetter(null);
  ioMock.mockClear();
  fakeSockets.length = 0;
  seedToken(null);
});

describe("useRecordPresence — Feature 3 wiring (R-RTC-1.4)", () => {
  it("joins the record room with recordType+recordId (the trusted binding)", async () => {
    seedToken(JWT);
    renderHook(() => useRecordPresence({ recordType: "equipment", recordId: "eq-1" }));
    const socket = await connectedSocket();

    const joinCall = socket.emit.mock.calls.find((c) => c[0] === "join");
    expect(joinCall).toBeTruthy();
    expect(joinCall![1]).toEqual({ kind: "record", recordType: "equipment", recordId: "eq-1" });
  });

  it("surfaces a peer editing the record (name resolved from server-attached presence)", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useRecordPresence({ recordType: "equipment", recordId: "eq-1" }),
    );
    const socket = await connectedSocket();

    await act(async () => acceptJoin(socket, [{ userId: "peer-1", displayName: "Alice" }]));
    act(() =>
      socket.trigger("presence", {
        room: ROOM,
        members: [{ userId: "peer-1", displayName: "Alice" }],
      }),
    );
    act(() => socket.trigger("peer-record", { userId: "peer-1", mode: "editing" }));

    expect(result.current.peerEditors).toEqual([{ userId: "peer-1", displayName: "Alice" }]);

    // A subsequent viewing event clears the editing advisory (no lock, never sticky).
    act(() => socket.trigger("peer-record", { userId: "peer-1", mode: "viewing" }));
    expect(result.current.peerEditors).toEqual([]);
  });

  it("drops a peer editor once presence shows they have left the record", async () => {
    seedToken(JWT);
    const { result } = renderHook(() =>
      useRecordPresence({ recordType: "equipment", recordId: "eq-1" }),
    );
    const socket = await connectedSocket();
    await act(async () => acceptJoin(socket, [{ userId: "peer-1", displayName: "Alice" }]));

    act(() =>
      socket.trigger("presence", {
        room: ROOM,
        members: [{ userId: "peer-1", displayName: "Alice" }],
      }),
    );
    act(() => socket.trigger("peer-record", { userId: "peer-1", mode: "editing" }));
    expect(result.current.peerEditors).toHaveLength(1);

    // Peer navigates away → server re-emits presence without them → advisory clears.
    act(() => socket.trigger("presence", { room: ROOM, members: [] }));
    expect(result.current.peerEditors).toEqual([]);
  });

  it("emits `record-presence` with the intent ONLY — no userId, no recordId/recordType", async () => {
    seedToken(JWT);
    const { rerender } = renderHook(
      ({ editing }) => useRecordPresence({ recordType: "equipment", recordId: "eq-1", editing }),
      { initialProps: { editing: false } },
    );
    const socket = await connectedSocket();
    await act(async () => acceptJoin(socket, []));

    // Mount → viewing intent.
    const firstPresence = socket.emit.mock.calls.find((c) => c[0] === "record-presence");
    expect(firstPresence).toBeTruthy();
    expect(firstPresence![1]).toEqual({ editing: false });
    expect(firstPresence![1]).not.toHaveProperty("userId");
    expect(firstPresence![1]).not.toHaveProperty("recordId");
    expect(firstPresence![1]).not.toHaveProperty("recordType");

    // Entering an edit → editing intent.
    await act(async () => rerender({ editing: true }));
    const presenceEmits = socket.emit.mock.calls.filter((c) => c[0] === "record-presence");
    expect(presenceEmits.at(-1)![1]).toEqual({ editing: true });
  });

  it("degrades with NO token: no socket, hook inert, no editors", async () => {
    seedToken(null);
    const { result } = renderHook(() =>
      useRecordPresence({ recordType: "equipment", recordId: "eq-1" }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(ioMock).not.toHaveBeenCalled();
    expect(fakeSockets).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.peerEditors).toEqual([]);
  });

  it("does NOT connect without a recordId (degrade — nothing to bind to)", async () => {
    seedToken(JWT);
    renderHook(() => useRecordPresence({ recordType: "equipment", recordId: "" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(ioMock).not.toHaveBeenCalled();
    expect(fakeSockets).toHaveLength(0);
  });
});

describe("RecordPresenceIndicator — advisory-only render + degradation", () => {
  it("renders '<name> is editing this' for a peer editor", () => {
    render(<RecordPresenceIndicator editors={[{ userId: "peer-1", displayName: "Alice" }]} />);
    expect(screen.getByText(t.recordCollab.editingThis("Alice"))).toBeTruthy();
  });

  it("falls back to a generic label when the peer name is unknown", () => {
    render(<RecordPresenceIndicator editors={[{ userId: "peer-1", displayName: "" }]} />);
    expect(screen.getByText(t.recordCollab.someoneEditing)).toBeTruthy();
  });

  it("is STRICTLY advisory — never renders an interactive control that could gate an edit", () => {
    render(<RecordPresenceIndicator editors={[{ userId: "peer-1", displayName: "Alice" }]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders NOTHING when there are no peer editors (degraded → zero indicator)", () => {
    const { container } = render(<RecordPresenceIndicator editors={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
