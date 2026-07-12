import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { shiftChatApi } from "../api";
import { reconcileMessages } from "../message-scoping";
import type { ShiftMessage, PostMessageInput } from "../types";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";

const QUERY_KEY = ["/api/shift-chat/messages"] as const;
const POLL_INTERVAL_OPEN_MS = 3_000;
const POLL_INTERVAL_CLOSED_MS = 15_000;
const TYPING_DEBOUNCE_MS = 1_500;

// Patch a single message in the local accumulator by id, leaving every other
// message untouched. Used by the react/ack mutations (R-SH-01): those
// mutations target a message that is often already below the strict-`gt` poll
// cursor, so a `queryClient.invalidateQueries` refetch would never re-deliver
// it — the open panel must instead merge the change in locally.
function patchMessageById(
  messages: ShiftMessage[],
  id: string,
  patch: (message: ShiftMessage) => ShiftMessage,
): ShiftMessage[] {
  const index = messages.findIndex((m) => m.id === id);
  if (index === -1) return messages;
  const next = messages.slice();
  next[index] = patch(next[index]!);
  return next;
}

export function useShiftChat(isOpen: boolean) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const afterRef    = useRef<string | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Poll for new messages ──────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => shiftChatApi.getMessages(afterRef.current),
    enabled: !!userId,
    refetchInterval: isOpen ? POLL_INTERVAL_OPEN_MS : POLL_INTERVAL_CLOSED_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  // Track the latest message timestamp for incremental polling
  useEffect(() => {
    if (data?.messages?.length) {
      const candidate = data.messages[data.messages.length - 1]!.createdAt;
      if (!afterRef.current || candidate > afterRef.current) {
        afterRef.current = candidate;
      }
    }
  }, [data?.messages]);

  // ── Local message accumulation ─────────────────────────────────────────────
  const [allMessages, setAllMessages] = useState<ShiftMessage[]>([]);
  const sessionRef = useRef<string | null>(null);

  // Reconcile every poll against the server's authoritative shift session, so a
  // shift that ends (shiftSessionId → null) clears the panel immediately and a
  // shift rollover swaps in the new conversation (BUG-001).
  useEffect(() => {
    if (!isOpen || !data) return;
    const current = data.shiftSessionId ?? null;
    setAllMessages((prev) => reconcileMessages(prev, data.messages ?? [], sessionRef.current, current));
    sessionRef.current = current;
  }, [data, isOpen]);

  // Full history on open; keep afterRef when closed so unread polls stay incremental.
  useEffect(() => {
    if (isOpen) {
      afterRef.current = undefined;
      sessionRef.current = null;
      setAllMessages([]);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } else {
      sessionRef.current = null;
      setAllMessages([]);
    }
  }, [isOpen, queryClient]);

  // ── Unread count ───────────────────────────────────────────────────────────
  const lastOpenRef  = useRef<number>(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
      lastOpenRef.current = Date.now();
      setUnreadCount(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && data?.messages?.length) {
      const newCount = data.messages.filter(
        (m) => new Date(m.createdAt).getTime() > lastOpenRef.current,
      ).length;
      if (newCount > 0) setUnreadCount((n) => n + newCount);
    }
  }, [data?.messages, isOpen]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (input: PostMessageInput) => shiftChatApi.postMessage(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("NO_OPEN_SHIFT") || msg.toLowerCase().includes("no active shift")) {
        toast.error(t.shiftChat.errors.noOpenShift);
      } else {
        toast.error(t.shiftChat.errors.sendFailed);
      }
    },
  });

  // ── Ack broadcast ──────────────────────────────────────────────────────────
  const ackMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "acknowledged" | "snoozed" }) =>
      shiftChatApi.ackMessage(id, status),
    onSuccess: (_result, { id, status }) => {
      if (!userId) return;
      setAllMessages((prev) =>
        patchMessageById(prev, id, (m) => ({
          ...m,
          acks: [...m.acks.filter((a) => a.userId !== userId), { userId, status }],
        })),
      );
    },
    onError: () => {
      toast.error(t.shiftChat.errors.ackFailed);
    },
  });

  // ── Typing indicator (debounced) ───────────────────────────────────────────
  const notifyTyping = useCallback(() => {
    if (typingTimer.current) return; // Already sent recently
    shiftChatApi.typing().catch(() => {});
    typingTimer.current = setTimeout(() => {
      typingTimer.current = null;
    }, TYPING_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  // ── React ──────────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: "👍" | "✅" | "👀" }) =>
      shiftChatApi.react(messageId, emoji),
    onSuccess: (result, { messageId, emoji }) => {
      if (!userId) return;
      setAllMessages((prev) =>
        patchMessageById(prev, messageId, (m) => {
          const withoutMine = m.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji));
          return {
            ...m,
            reactions: result.action === "removed" ? withoutMine : [...withoutMine, { userId, emoji }],
          };
        }),
      );
    },
    onError: () => {
      toast.error(t.shiftChat.errors.reactFailed);
    },
  });

  // ── Pin ────────────────────────────────────────────────────────────────────
  const pinMutation = useMutation({
    mutationFn: (messageId: string) => shiftChatApi.pinMessage(messageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: () => {
      toast.error(t.shiftChat.errors.pinFailed);
    },
  });

  return {
    messages:      allMessages,
    pinnedMessage: data?.pinnedMessage ?? null,
    typing:        data?.typing ?? [],
    onlineUserIds: data?.onlineUserIds ?? [],
    isLoading,
    unreadCount,
    sendMessage:   sendMutation.mutate,
    isSending:     sendMutation.isPending,
    ackMessage:    ackMutation.mutate,
    reactToMessage: reactMutation.mutate,
    pinMessage:    pinMutation.mutate,
    notifyTyping,
    currentUserId: userId,
  };
}
