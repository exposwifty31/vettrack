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
import { resolveBearerToken } from "@/lib/auth-fetch";

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
 *  - FRESH token: the handshake token is minted from the SAME getter `authFetch`
 *    uses (`resolveBearerToken` → the Clerk getter), re-read on every (re)connect
 *    and refreshed on a cadence below the token TTL — a token that has rolled
 *    over is never replayed under the infinite-reconnect loop. — card SC (HIGH).
 *  - The nudge is advisory: it only triggers the EXISTING REST refetch and is
 *    coalesced by messageId so duplicate emissions + reconnect replays cause at
 *    most one refetch per new message. A malformed (missing-id) nudge is ignored
 *    outright, never coalesced under a shared empty key. WS is never the message
 *    store.
 */

const TYPING_DEBOUNCE_MS = 1_500;
const PEER_TYPING_TTL_MS = 4_000;
const MAX_SEEN_NUDGES = 500;
// Re-mint the handshake token below the Clerk session-token TTL (~60s) so any
// reconnect the shared socket performs reads a still-valid token. — card SC.
const TOKEN_REFRESH_MS = 45_000;

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
  const socketRef = useRef<CollabSocket | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const seenNudgeIds = useRef<Set<string>>(new Set());
  const typingOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const peerTypingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Latest freshly-minted bearer token. The (sync) collab auth source re-reads
  // this on every (re)connect, so keeping it fresh keeps reconnects authorised.
  const tokenRef = useRef<string | null>(null);

  // Keep the callback fresh without re-running the connect effect.
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;

  const [isConnected, setIsConnected] = useState(false);
  const [peerTypingUserIds, setPeerTypingUserIds] = useState<string[]>([]);
  const [presentMembers, setPresentMembers] = useState<CollabMember[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let acquired: CollabSocket | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * Fresh-token auth source. Re-read the latest minted token on every
     * (re)connect — never a static/stale snapshot. Returns null (→ degrade) when
     * no token is available (dev-bypass / signed-out).
     */
    const authSource: CollabAuthSource = () =>
      tokenRef.current ? { token: tokenRef.current } : null;

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

    const connect = () => {
      if (cancelled) return;
      const socket = getCollabSocket(authSource);
      if (!socket) return; // degrade — no token / channel unavailable
      acquired = socket;
      socketRef.current = socket;

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("presence", handlePresence);
      socket.on("peer-typing", handlePeerTyping);
      socket.on("chat-nudge", handleNudge);
      if (isCollabConnected()) setIsConnected(true);

      void joinCollabRoom(socket, { kind: "chat" }).then((ack) => {
        if (cancelled) return;
        if (ack?.ok) {
          if (ack.room) joinedRoomRef.current = ack.room;
          if (ack.members) setPresentMembers(ack.members);
        }
      });
    };

    // Mint a FRESH token before the first connect (fixes the "panel opened past
    // the token TTL → expired handshake" bug), then re-mint on a cadence so the
    // shared socket's infinite reconnects always read a valid token.
    void resolveBearerToken().then((token) => {
      if (cancelled) return;
      tokenRef.current = token;
      connect();
    });
    refreshTimer = setInterval(() => {
      void resolveBearerToken().then((token) => {
        if (!cancelled) tokenRef.current = token;
      });
    }, TOKEN_REFRESH_MS);

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (typingOffTimer.current) {
        clearTimeout(typingOffTimer.current);
        typingOffTimer.current = null;
      }
      for (const timer of peerTypingTimers.current.values()) clearTimeout(timer);
      peerTypingTimers.current.clear();
      if (acquired) {
        acquired.off("connect", handleConnect);
        acquired.off("disconnect", handleDisconnect);
        acquired.off("presence", handlePresence);
        acquired.off("peer-typing", handlePeerTyping);
        acquired.off("chat-nudge", handleNudge);
        if (joinedRoomRef.current) leaveCollabRoom(acquired, joinedRoomRef.current);
        // Only release when a socket was actually acquired — a null (degraded)
        // getCollabSocket must NOT be paired with a release. — collab-socket contract.
        releaseCollabSocket();
      }
      joinedRoomRef.current = null;
      socketRef.current = null;
      typingActiveRef.current = false;
      tokenRef.current = null;
      seenNudgeIds.current.clear();
      setIsConnected(false);
      setPeerTypingUserIds([]);
      setPresentMembers([]);
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
