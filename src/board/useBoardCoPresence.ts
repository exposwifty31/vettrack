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
 * R-RTC-1.3 · Feature 2 — wires the EPHEMERAL + ADVISORY collaboration channel
 * into `/board`: peer cursors, co-presence, and selection highlights.
 *
 * FROZEN guardrails honoured here:
 *  - LAZY connect: the ref-counted socket is acquired only while the board is
 *    mounted (BoardShell) and released on unmount — never app-wide.
 *  - GRACEFUL DEGRADATION: when the socket is unavailable (no token / not
 *    connected) this hook is inert — the board renders EXACTLY as today (static,
 *    no peer overlay) and NOTHING about board rendering is gated on the socket.
 *  - The client NEVER sends its own userId. `board-cursor` carries only the
 *    NORMALIZED {x,y}; `board-selection` only the entityId. The server attaches
 *    identity from the DB session before fanning out.
 *  - CLIENT-THROTTLED cursor emission (~<=15/s, under the server 20/s cap) so a
 *    steady pointer stream can never approach the server rate limit.
 *  - Coordinates are normalized to [0,1] (pointer / viewport) and clamped — a raw
 *    pixel coordinate is never relayed, and no coordinate is ever put in telemetry.
 *  - FRESH token: the handshake token is minted from the SAME getter `authFetch`
 *    uses (`resolveBearerToken` → the Clerk getter), re-read on every (re)connect
 *    and refreshed on a cadence below the token TTL — a rolled-over token is never
 *    replayed under the infinite-reconnect loop.
 */

// ~15 emissions/s max — comfortably under the server's 20/s per-socket cap.
const CURSOR_MIN_INTERVAL_MS = 66;
// <=4 emissions/s — comfortably under the server's 5/s per-socket selection cap.
const SELECTION_MIN_INTERVAL_MS = 250;
// Drop a peer's cursor if it goes quiet (peer left / stopped moving / dropped event).
const PEER_CURSOR_TTL_MS = 5_000;
// Drop a peer's selection if it goes stale — there is no deselect event in the
// contract, so a receiver-side TTL clears a highlight the peer moved off.
const PEER_SELECTION_TTL_MS = 8_000;
// Re-mint the handshake token below the Clerk session-token TTL (~60s).
const TOKEN_REFRESH_MS = 45_000;

export interface BoardMember {
  userId: string;
  displayName: string;
}

export interface BoardPeerCursor {
  userId: string;
  x: number;
  y: number;
}

export interface BoardPeerSelection {
  userId: string;
  entityId: string;
}

export interface BoardCoPresenceState {
  isConnected: boolean;
  presentMembers: BoardMember[];
  peerCursors: BoardPeerCursor[];
  peerSelections: BoardPeerSelection[];
  /** Emit the board's highlighted entity id (advisory) — no-op when degraded. */
  selectEntity: (entityId: string | null) => void;
}

export interface UseBoardCoPresenceOptions {
  /** Acquire the socket only while the board is mounted (lazy). Default true. */
  enabled?: boolean;
  /** Monotonic clock for the client throttle — test seam; defaults to Date.now. */
  now?: () => number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function useBoardCoPresence(options: UseBoardCoPresenceOptions = {}): BoardCoPresenceState {
  const { enabled = true, now = Date.now } = options;

  const socketRef = useRef<CollabSocket | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const lastCursorEmitRef = useRef(Number.NEGATIVE_INFINITY);
  const lastSelectionEmitRef = useRef(Number.NEGATIVE_INFINITY);
  const nowRef = useRef(now);
  nowRef.current = now;
  const peerCursorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const peerSelectionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [isConnected, setIsConnected] = useState(false);
  const [presentMembers, setPresentMembers] = useState<BoardMember[]>([]);
  const [peerCursors, setPeerCursors] = useState<BoardPeerCursor[]>([]);
  const [peerSelections, setPeerSelections] = useState<BoardPeerSelection[]>([]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let acquired: CollabSocket | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    const cursorTimers = peerCursorTimers.current;
    const selectionTimers = peerSelectionTimers.current;

    const authSource: CollabAuthSource = () =>
      tokenRef.current ? { token: tokenRef.current } : null;

    // Re-emit join on EVERY (re)connect. socket.io rooms are per-connection and
    // reconnection is ON (Infinity), so after any WS blip the reconnected socket
    // has NO room membership — PERMANENT death for the overlay on the long-lived
    // /board kiosk unless we re-join. Idempotent server-side. — panel #1 (HIGH).
    const doJoin = () => {
      const socket = socketRef.current;
      if (!socket) return;
      void joinCollabRoom(socket, { kind: "board" }).then((ack) => {
        if (cancelled) return;
        if (ack?.ok) {
          if (ack.room) joinedRoomRef.current = ack.room;
          if (ack.members) setPresentMembers(ack.members);
        }
      });
    };

    const handleConnect = () => {
      setIsConnected(true);
      doJoin();
    };
    const handleDisconnect = () => setIsConnected(false);

    const handlePresence = (payload: { room: string; members: BoardMember[] }) => {
      // Drop presence for any OTHER room — on the SHARED ref-counted socket a
      // room-A event must not overwrite the board's room-B roster. The board's own
      // initial roster still arrives via the join ack.members. — panel #3 (MEDIUM).
      if (joinedRoomRef.current && payload?.room !== joinedRoomRef.current) return;
      setPresentMembers(Array.isArray(payload?.members) ? payload.members : []);
    };

    const handlePeerCursor = (payload: { userId: string; x: number; y: number }) => {
      const userId = payload?.userId;
      if (!userId || !Number.isFinite(payload?.x) || !Number.isFinite(payload?.y)) return;
      const x = clamp01(payload.x);
      const y = clamp01(payload.y);
      setPeerCursors((prev) => {
        const rest = prev.filter((c) => c.userId !== userId);
        return [...rest, { userId, x, y }];
      });
      const existing = cursorTimers.get(userId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        cursorTimers.delete(userId);
        setPeerCursors((prev) => prev.filter((c) => c.userId !== userId));
      }, PEER_CURSOR_TTL_MS);
      cursorTimers.set(userId, timer);
    };

    const handlePeerSelection = (payload: { userId: string; entityId: string }) => {
      const userId = payload?.userId;
      const entityId = typeof payload?.entityId === "string" ? payload.entityId : "";
      if (!userId || !entityId) return;
      setPeerSelections((prev) => {
        const rest = prev.filter((s) => s.userId !== userId);
        return [...rest, { userId, entityId }];
      });
      const existing = selectionTimers.get(userId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        selectionTimers.delete(userId);
        setPeerSelections((prev) => prev.filter((s) => s.userId !== userId));
      }, PEER_SELECTION_TTL_MS);
      selectionTimers.set(userId, timer);
    };

    const handlePointerMove = (event: MouseEvent) => {
      const socket = socketRef.current;
      if (!socket || !isCollabConnected()) return; // degrade — never gate on the socket
      const ts = nowRef.current();
      if (ts - lastCursorEmitRef.current < CURSOR_MIN_INTERVAL_MS) return; // client throttle
      lastCursorEmitRef.current = ts;
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      // NO userId — the server attaches identity. Normalized + clamped to [0,1].
      socket.emit("board-cursor", {
        x: clamp01(event.clientX / width),
        y: clamp01(event.clientY / height),
      });
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
      socket.on("peer-cursor", handlePeerCursor);
      socket.on("peer-selection", handlePeerSelection);
      // If the socket is ALREADY connected when listeners are bound, the `connect`
      // event has already fired and handleConnect won't run — join once explicitly
      // now. Every later (re)connect re-runs doJoin via handleConnect. — panel #1.
      if (isCollabConnected()) {
        setIsConnected(true);
        doJoin();
      }
    };

    // Mint a FRESH token before the first connect, then re-mint on a cadence so the
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

    window.addEventListener("pointermove", handlePointerMove);

    return () => {
      cancelled = true;
      window.removeEventListener("pointermove", handlePointerMove);
      if (refreshTimer) clearInterval(refreshTimer);
      for (const timer of cursorTimers.values()) clearTimeout(timer);
      cursorTimers.clear();
      for (const timer of selectionTimers.values()) clearTimeout(timer);
      selectionTimers.clear();
      if (acquired) {
        acquired.off("connect", handleConnect);
        acquired.off("disconnect", handleDisconnect);
        acquired.off("presence", handlePresence);
        acquired.off("peer-cursor", handlePeerCursor);
        acquired.off("peer-selection", handlePeerSelection);
        if (joinedRoomRef.current) leaveCollabRoom(acquired, joinedRoomRef.current);
        // Only release when a socket was actually acquired — a null (degraded)
        // getCollabSocket must NOT be paired with a release.
        releaseCollabSocket();
      }
      joinedRoomRef.current = null;
      socketRef.current = null;
      tokenRef.current = null;
      lastCursorEmitRef.current = Number.NEGATIVE_INFINITY;
      lastSelectionEmitRef.current = Number.NEGATIVE_INFINITY;
      setIsConnected(false);
      setPresentMembers([]);
      setPeerCursors([]);
      setPeerSelections([]);
    };
  }, [enabled]);

  const selectEntity = useCallback((entityId: string | null) => {
    const socket = socketRef.current;
    if (!socket || !isCollabConnected()) return; // degrade — never gate on the socket
    const id = typeof entityId === "string" ? entityId.trim() : "";
    // No deselect event in the contract; a null/empty clear is a local no-op and the
    // peer-side TTL clears a stale highlight.
    if (!id) return;
    const ts = nowRef.current();
    if (ts - lastSelectionEmitRef.current < SELECTION_MIN_INTERVAL_MS) return; // client throttle
    lastSelectionEmitRef.current = ts;
    socket.emit("board-selection", { entityId: id }); // NO userId — server attaches identity
  }, []);

  return { isConnected, presentMembers, peerCursors, peerSelections, selectEntity };
}
