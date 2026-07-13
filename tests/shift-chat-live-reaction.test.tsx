/**
 * @vitest-environment happy-dom
 *
 * T-25 (R-SH-01 · CLICK-PATH-007) — reactions/acks never render live.
 *
 * useShiftChat accumulates messages via a strict-`gt` poll (`afterRef`): once a
 * message's `createdAt` is <= the last-seen cursor, the server never returns it
 * again, so `queryClient.invalidateQueries` on react/ack mutation success is a
 * no-op for that message. A reaction or ack on an already-loaded message must
 * instead patch the local accumulator by id so the open panel reflects it
 * immediately — without depending on the next poll to re-deliver the message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShiftMessage, MessagesResponse } from "@/features/shift-chat/types";

const getMessagesMock = vi.fn();
const reactMock = vi.fn();
const ackMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/features/shift-chat/api", () => ({
  shiftChatApi: {
    getMessages: (...args: unknown[]) => getMessagesMock(...args),
    postMessage: vi.fn(),
    ackMessage: (...args: unknown[]) => ackMock(...args),
    pinMessage: vi.fn(),
    react: (...args: unknown[]) => reactMock(...args),
    typing: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "tech-1" }),
}));

import { useShiftChat } from "@/features/shift-chat/hooks/useShiftChat";

function msg(overrides: Partial<ShiftMessage> = {}): ShiftMessage {
  return {
    id: "m-1",
    shiftSessionId: "s-1",
    clinicId: "c-1",
    senderId: "u-2",
    senderName: "Dana",
    senderRole: "vet_tech",
    body: "already loaded",
    type: "broadcast",
    broadcastKey: "department_close",
    systemEventType: null,
    systemEventPayload: null,
    roomTag: null,
    isUrgent: false,
    mentionedUserIds: [],
    pinnedAt: null,
    pinnedByUserId: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    acks: [],
    reactions: [],
    ...overrides,
  };
}

function response(messages: ShiftMessage[]): MessagesResponse {
  return { messages, pinnedMessage: null, typing: [], onlineUserIds: [], shiftSessionId: "s-1" };
}

describe("useShiftChat — reactions/acks render live via merge-by-id (T-25 · R-SH-01)", () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => cleanup());

  it("a reaction on an already-loaded message updates the open panel without a gt refetch", async () => {
    getMessagesMock.mockResolvedValue(response([msg()]));
    reactMock.mockResolvedValue({ action: "added" });

    const { result } = renderHook(() => useShiftChat(true), { wrapper });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]!.reactions).toEqual([]);

    // Subsequent polls (strict `gt`) never return this already-loaded message
    // again — this is the exact condition that hides the reaction pre-fix.
    getMessagesMock.mockResolvedValue(response([]));

    result.current.reactToMessage({ messageId: "m-1", emoji: "👍" });

    await waitFor(() => {
      expect(result.current.messages[0]!.reactions).toContainEqual({ userId: "tech-1", emoji: "👍" });
    });
  });

  it("an ack on an already-loaded message updates the open panel without a gt refetch", async () => {
    getMessagesMock.mockResolvedValue(response([msg({ id: "m-2" })]));
    ackMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useShiftChat(true), { wrapper });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]!.acks).toEqual([]);

    getMessagesMock.mockResolvedValue(response([]));

    result.current.ackMessage({ id: "m-2", status: "acknowledged" });

    await waitFor(() => {
      expect(result.current.messages[0]!.acks).toContainEqual({ userId: "tech-1", status: "acknowledged" });
    });
  });
});
