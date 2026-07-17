import { useCallback, useRef, useState } from "react";
import { isCollabConnected } from "@/lib/collab-socket";
import { useCollabRoom, type CollabRoomBinding } from "@/features/collab/useCollabRoom";

/**
 * R-RTC-1.2 · Feature 1 — wires the EPHEMERAL + ADVISORY collaboration channel
 * into shift-chat: peer typing, presence, and a coalesced "new message" nudge.
 *
 * The SHARED socket lifecycle (lazy connect, fresh-token handshake, re-join on
 * reconnect, presence room-filter, graceful degradation, ref-count release) lives
 * in `useCollabRoom`; this hook layers ONLY shift-chat's own logic on top:
 *  - Peer typing indicator with a receiver-side TTL (a lost "off" self-expires).
 *  - A debounced local `typing` ping — carrying the on-flag ONLY, never a
 *    client-supplied userId (the server attaches identity). No-op when degraded.
 *  - An advisory "new message" nudge that only triggers the EXISTING REST refetch,
 *    coalesced by messageId so duplicate emissions + reconnect replays cause at
 *    most one refetch per new message. A malformed (missing-id) nudge is ignored
 *    outright, never coalesced under a shared empty key. WS is never the message
 *    store.
 */

const TYPING_DEBOUNCE_MS = 1_500;
const PEER_TYPING_TTL_MS = 4_000;
const MAX_SEEN_NUDGES = 500;

export interface CollabMember {
  userId: string;
  displayName: string;
}

export interface ShiftChatCollabState {
  isConnected: boolean;
  peerTypingUserIds: string[];
  presentMembers: CollabMember[];
  /** Debounced typing ping — no-op when the socket is unavailable. */
  notifyTyping: () => void;
}

export interface UseShiftChatCollabOptions {
  /** Acquire the socket only while the panel is actually open (lazy connect). */
  enabled: boolean;
  /**
   * Called at most once per unique new-message id (coalesced) to trigger the
   * EXISTING REST refetch. WS is never the message store.
   */
  onNewMessage: () => void;
}

export function useShiftChatCollab({
  enabled,
  onNewMessage,
}: UseShiftChatCollabOptions): ShiftChatCollabState {
  const seenNudgeIds = useRef<Set<string>>(new Set());
  const typingOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const peerTypingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Keep the callback fresh without re-binding the socket listeners.
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;

  const [peerTypingUserIds, setPeerTypingUserIds] = useState<string[]>([]);

  const bindEvents = useCallback(({ on }: CollabRoomBinding) => {
    const handlePeerTyping = (payload: { userId: string; on: boolean }) => {
      const userId = payload?.userId;
      if (!userId) return;
      const timers = peerTypingTimers.current;
      const existing = timers.get(userId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(userId);
      }
      if (payload.on) {
        setPeerTypingUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
        // Auto-expire in case a peer's "off" is lost (disconnect / dropped event).
        const timer = setTimeout(() => {
          timers.delete(userId);
          setPeerTypingUserIds((prev) => prev.filter((id) => id !== userId));
        }, PEER_TYPING_TTL_MS);
        timers.set(userId, timer);
      } else {
        setPeerTypingUserIds((prev) => prev.filter((id) => id !== userId));
      }
    };

    const handleNudge = (payload: { messageId: string }) => {
      // A malformed nudge (missing / non-string / empty id) is IGNORED outright —
      // never refetch, and never coalesce distinct empties under a shared "" key.
      const id = typeof payload?.messageId === "string" ? payload.messageId.trim() : "";
      if (!id) return;
      // Coalesce: at most ONE refetch per unique message id. Duplicate nudges and
      // reconnect replays collapse; REST/SSE stays the source of truth.
      if (seenNudgeIds.current.has(id)) return;
      seenNudgeIds.current.add(id);
      if (seenNudgeIds.current.size > MAX_SEEN_NUDGES) {
        const oldest = seenNudgeIds.current.values().next().value;
        if (oldest !== undefined) seenNudgeIds.current.delete(oldest);
      }
      onNewMessageRef.current();
    };

    on("peer-typing", handlePeerTyping);
    on("chat-nudge", handleNudge);

    return () => {
      if (typingOffTimer.current) {
        clearTimeout(typingOffTimer.current);
        typingOffTimer.current = null;
      }
      for (const timer of peerTypingTimers.current.values()) clearTimeout(timer);
      peerTypingTimers.current.clear();
      typingActiveRef.current = false;
      seenNudgeIds.current.clear();
      setPeerTypingUserIds([]);
    };
  }, []);

  const { isConnected, presentMembers, socketRef } = useCollabRoom({
    enabled,
    joinRequest: { kind: "chat" },
    bindEvents,
  });

  const notifyTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !isCollabConnected()) return; // degrade — REST typing still runs
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      socket.emit("typing", { on: true }); // NO userId — server attaches identity
    }
    if (typingOffTimer.current) clearTimeout(typingOffTimer.current);
    typingOffTimer.current = setTimeout(() => {
      typingActiveRef.current = false;
      socketRef.current?.emit("typing", { on: false });
    }, TYPING_DEBOUNCE_MS);
  }, [socketRef]);

  return { isConnected, peerTypingUserIds, presentMembers, notifyTyping };
}
