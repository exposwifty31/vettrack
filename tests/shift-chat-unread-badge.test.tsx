/**
 * @vitest-environment happy-dom
 *
 * T-26 (R-SH-02 · CLICK-PATH-017) — unread badge off-by-one on open→close.
 *
 * The "unread count" reset effect stamps `lastOpenRef` at OPEN time only. If a
 * poll delivers a fresh batch while the panel is still open (read live, no
 * badge needed), that batch's `createdAt` is necessarily after the open-time
 * stamp. Closing the panel then re-runs the unread-counting effect against the
 * SAME stale open-time stamp, so the just-read batch gets miscounted as
 * unread the moment the panel closes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShiftMessage, MessagesResponse } from "@/features/shift-chat/types";

const QUERY_KEY = ["/api/shift-chat/messages"] as const;

const getMessagesMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/features/shift-chat/api", () => ({
  shiftChatApi: {
    getMessages: (...args: unknown[]) => getMessagesMock(...args),
    postMessage: vi.fn(),
    ackMessage: vi.fn(),
    pinMessage: vi.fn(),
    react: vi.fn(),
    typing: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "tech-1" }),
}));

import { useShiftChat } from "@/features/shift-chat/hooks/useShiftChat";

let seq = 0;
function msg(overrides: Partial<ShiftMessage> = {}): ShiftMessage {
  return {
    id: `m-${seq++}`,
    shiftSessionId: "s-1",
    clinicId: "c-1",
    senderId: "u-2",
    senderName: "Dana",
    senderRole: "vet_tech",
    body: "hello",
    type: "regular",
    broadcastKey: null,
    systemEventType: null,
    systemEventPayload: null,
    roomTag: null,
    isUrgent: false,
    mentionedUserIds: [],
    pinnedAt: null,
    pinnedByUserId: null,
    createdAt: new Date().toISOString(),
    acks: [],
    reactions: [],
    ...overrides,
  };
}

function response(messages: ShiftMessage[]): MessagesResponse {
  return { messages, pinnedMessage: null, typing: [], onlineUserIds: [], shiftSessionId: "s-1" };
}

describe("useShiftChat — unread badge excludes the just-read batch (T-26 · R-SH-02)", () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => cleanup());

  it("does not recount the batch read while open as unread once the panel closes", async () => {
    getMessagesMock.mockResolvedValue(response([]));

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useShiftChat(isOpen),
      { wrapper, initialProps: { isOpen: true } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A batch arrives WHILE the panel is open — read live, no badge expected.
    const openBatch = [msg()];
    getMessagesMock.mockResolvedValue(response(openBatch));
    await client.refetchQueries({ queryKey: QUERY_KEY });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.unreadCount).toBe(0);

    // Close the panel — the batch above was already read; it must not be
    // recounted as unread on close.
    rerender({ isOpen: false });

    await waitFor(() => expect(result.current.unreadCount).toBe(0));
  });

  it("still counts a genuinely new message that arrives after close", async () => {
    getMessagesMock.mockResolvedValue(response([]));

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useShiftChat(isOpen),
      { wrapper, initialProps: { isOpen: true } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const openBatch = [msg()];
    getMessagesMock.mockResolvedValue(response(openBatch));
    await client.refetchQueries({ queryKey: QUERY_KEY });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    rerender({ isOpen: false });
    await waitFor(() => expect(result.current.unreadCount).toBe(0));

    // A brand-new message shows up after the panel is closed.
    const newMessage = msg({ createdAt: new Date(Date.now() + 5_000).toISOString() });
    getMessagesMock.mockResolvedValue(response([...openBatch, newMessage]));
    await client.refetchQueries({ queryKey: QUERY_KEY });

    await waitFor(() => expect(result.current.unreadCount).toBe(1));
  });
});
