import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCollabSocket,
  isCollabConnected,
  joinCollabRoom,
  leaveCollabRoom,
  releaseCollabSocket,
  type CollabAuthSource,
  type CollabSocket,
} from "@/lib/collab-socket";
import { getStoredBearerToken } from "@/lib/auth-store";

/**
 * R-RTC-1.2 · Feature 1 — wires the EPHEMERAL + ADVISORY collaboration channel
 * into shift-chat: peer typing, presence, and a coalesced "new message" nudge.
 *
 * FROZEN guardrails honoured here:
 *  - LAZY connect: the ref-counted socket is acquired only while the panel is
 *    open (`enabled`) and released on close/unmount — never app-wide.
 *  - GRACEFUL DEGRADATION: when the socket is unavailable (no token / not
 *    connected) this hook is inert — the panel keeps working via the existing
 *    REST-poll `getPresence`/`typing` path and message send/receive is NEVER
 *    gated on the socket.
 *  - The client NEVER sends its own userId; `typing` carries only the on-flag
 *    and the server attaches identity from the DB session.
 *  - The nudge is advisory: it only triggers the EXISTING REST refetch and is
 *    coalesced by messageId so duplicate emissions + reconnect replays cause at
 *    most one refetch per new message. WS is never the message store.
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

/**
 * Fresh-token auth source. Read the app's CURRENT bearer token on every
 * (re)connect — the exact store the REST client authenticates from — so a
 * refreshed session token is used instead of a replayed stale one. Returns null
 * (→ degrade) in dev-bypass / signed-out.
 */
const collabAuthSource: CollabAuthSource = () => {
  const token = getStoredBearerToken();
  return token ? { token } : null;
};

export function useShiftChatCollab({
  enabled,
  onNewMessage,
}: UseShiftChatCollabOptions): ShiftChatCollabState {
  const socketRef = useRef<CollabSocket | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const seenNudgeIds = useRef<Set<string>>(new Set());
  const typingOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const peerTypingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Keep the callback fresh without re-running the connect effect.
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;

  const [isConnected, setIsConnected] = useState(false);
  const [peerTypingUserIds, setPeerTypingUserIds] = useState<string[]>([]);
  const [presentMembers, setPresentMembers] = useState<CollabMember[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const socket = getCollabSocket(collabAuthSource);
    if (!socket) return; // degrade — no token / channel unavailable
    socketRef.current = socket;

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    const handlePresence = (payload: { room: string; members: CollabMember[] }) => {
      setPresentMembers(Array.isArray(payload?.members) ? payload.members : []);
    };

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
      const id = typeof payload?.messageId === "string" ? payload.messageId : "";
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

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("presence", handlePresence);
    socket.on("peer-typing", handlePeerTyping);
    socket.on("chat-nudge", handleNudge);
    if (isCollabConnected()) setIsConnected(true);

    let active = true;
    void joinCollabRoom(socket, { kind: "chat" }).then((ack) => {
      if (!active) return;
      if (ack?.ok) {
        if (ack.room) joinedRoomRef.current = ack.room;
        if (ack.members) setPresentMembers(ack.members);
      }
    });

    return () => {
      active = false;
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("presence", handlePresence);
      socket.off("peer-typing", handlePeerTyping);
      socket.off("chat-nudge", handleNudge);
      if (typingOffTimer.current) {
        clearTimeout(typingOffTimer.current);
        typingOffTimer.current = null;
      }
      for (const timer of peerTypingTimers.current.values()) clearTimeout(timer);
      peerTypingTimers.current.clear();
      if (joinedRoomRef.current) leaveCollabRoom(socket, joinedRoomRef.current);
      joinedRoomRef.current = null;
      socketRef.current = null;
      typingActiveRef.current = false;
      seenNudgeIds.current.clear();
      setIsConnected(false);
      setPeerTypingUserIds([]);
      setPresentMembers([]);
      releaseCollabSocket();
    };
  }, [enabled]);

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
  }, []);

  return { isConnected, peerTypingUserIds, presentMembers, notifyTyping };
}
