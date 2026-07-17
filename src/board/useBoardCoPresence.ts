import { useCallback, useEffect, useRef, useState } from "react";
import { isCollabConnected } from "@/lib/collab-socket";
import { useCollabRoom, type CollabRoomBinding } from "@/features/collab/useCollabRoom";

/**
 * R-RTC-1.3 · Feature 2 — wires the EPHEMERAL + ADVISORY collaboration channel
 * into `/board`: peer cursors, co-presence, and selection highlights.
 *
 * The SHARED socket lifecycle (lazy connect, fresh-token handshake, re-join on
 * reconnect, presence room-filter, graceful degradation, ref-count release) lives
 * in `useCollabRoom`; this hook layers ONLY the board's own logic on top:
 *  - CLIENT-THROTTLED cursor emission (~<=15/s, under the server 20/s cap) so a
 *    steady pointer stream can never approach the server rate limit.
 *  - Coordinates normalized to [0,1] (pointer / viewport) and clamped — a raw
 *    pixel coordinate is never relayed, and no coordinate is ever put in telemetry.
 *  - Peer cursors / selections with receiver-side TTLs (no deselect event in the
 *    contract), and a throttled `board-selection` emit.
 *  - The client NEVER sends its own userId; the server attaches identity.
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

  const lastCursorEmitRef = useRef(Number.NEGATIVE_INFINITY);
  const lastSelectionEmitRef = useRef(Number.NEGATIVE_INFINITY);
  const nowRef = useRef(now);
  nowRef.current = now;
  const peerCursorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const peerSelectionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [peerCursors, setPeerCursors] = useState<BoardPeerCursor[]>([]);
  const [peerSelections, setPeerSelections] = useState<BoardPeerSelection[]>([]);

  const bindEvents = useCallback(({ on }: CollabRoomBinding) => {
    const cursorTimers = peerCursorTimers.current;
    const selectionTimers = peerSelectionTimers.current;

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

    on("peer-cursor", handlePeerCursor);
    on("peer-selection", handlePeerSelection);

    return () => {
      for (const timer of cursorTimers.values()) clearTimeout(timer);
      cursorTimers.clear();
      for (const timer of selectionTimers.values()) clearTimeout(timer);
      selectionTimers.clear();
      setPeerCursors([]);
      setPeerSelections([]);
    };
  }, []);

  // The base owns `presentMembers` (BoardMember is structurally CollabRoomMember).
  const { isConnected, presentMembers, socketRef } = useCollabRoom({
    enabled,
    joinRequest: { kind: "board" },
    bindEvents,
  });

  // Client-throttled cursor emission. This listener is independent of the socket
  // acquire — it reads `socketRef.current` at emit time and no-ops when the socket
  // is unavailable, so the board is NEVER gated on the socket. — degradation.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

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

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      lastCursorEmitRef.current = Number.NEGATIVE_INFINITY;
      lastSelectionEmitRef.current = Number.NEGATIVE_INFINITY;
    };
  }, [enabled, socketRef]);

  const selectEntity = useCallback(
    (entityId: string | null) => {
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
    },
    [socketRef],
  );

  return {
    isConnected,
    presentMembers,
    peerCursors,
    peerSelections,
    selectEntity,
  };
}
