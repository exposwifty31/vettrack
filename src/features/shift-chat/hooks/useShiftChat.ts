import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { shiftChatApi } from "../api";
import type { ShiftMessage, PostMessageInput } from "../types";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";

const QUERY_KEY = ["/api/shift-chat/messages"] as const;
const POLL_INTERVAL_OPEN_MS = 3_000;
const POLL_INTERVAL_CLOSED_MS = 15_000;
const TYPING_DEBOUNCE_MS = 1_500;

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

  useEffect(() => {
    if (!isOpen || !data?.messages?.length) return;
    setAllMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const newOnes = data.messages.filter((m) => !existingIds.has(m.id));
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
    });
  }, [data?.messages, isOpen]);

  // Full history on open; keep afterRef when closed so unread polls stay incremental.
  useEffect(() => {
    if (isOpen) {
      afterRef.current = undefined;
      setAllMessages([]);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } else {
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
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
