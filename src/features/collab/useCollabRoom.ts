import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  getCollabSocket,
  isCollabConnected,
  joinCollabRoom,
  leaveCollabRoom,
  releaseCollabSocket,
  type CollabAuthSource,
  type CollabJoinRequest,
  type CollabSocket,
  type ServerToClientEvents,
} from "@/lib/collab-socket";
import { resolveBearerToken } from "@/lib/auth-fetch";

/**
 * R-RTC-1 · panel #5 — the SHARED socket-lifecycle base hook for the three collab
 * surfaces (shift-chat, `/board`, record-detail). After the panel #1/#3 fixes the
 * lifecycle scaffolding across those hooks was byte-for-byte identical; this hook
 * OWNS that scaffolding once, parameterized by the join request + a binder for the
 * feature-specific server→client handlers. Each feature hook keeps only its own
 * logic (typing debounce / cursor throttle / edit-intent) on top of this.
 *
 * FROZEN guardrails preserved verbatim (do not weaken):
 *  - FRESH token: `authSource` re-reads the latest minted token on every
 *    (re)connect; the token is minted before the first connect and re-minted on a
 *    cadence below the Clerk session-token TTL — a rolled-over token is never
 *    replayed under the infinite-reconnect loop. — card SC / H6.
 *  - RE-JOIN on EVERY (re)connect: socket.io rooms are per-connection and
 *    reconnection is ON (Infinity), so `handleConnect` re-emits `join`; if the
 *    socket is ALREADY connected when listeners bind we join once explicitly. — #1.
 *  - PRESENCE room-filter: on the SHARED ref-counted socket a room-A presence event
 *    must not overwrite this hook's room-B roster. — panel #3.
 *  - GRACEFUL DEGRADATION: `getCollabSocket` returning null → the hook is inert
 *    (no listeners, no join, no release). NO core action is ever gated on it.
 *  - REF-COUNT lease: `releaseCollabSocket` is called ONLY when a socket was
 *    actually acquired — a null (degraded) acquire must NOT be paired with a
 *    release. — collab-socket H1 contract.
 *  - The client NEVER sends its own userId; identity + recordId are server-derived
 *    from the authorized room membership (enforced by the primitive + server).
 */

// Re-mint the handshake token below the Clerk session-token TTL (~60s) so any
// reconnect the shared socket performs reads a still-valid token. — card SC.
const TOKEN_REFRESH_MS = 45_000;

export interface CollabRoomMember {
  userId: string;
  displayName: string;
}

/** Handed to a feature binder so it can attach its own server→client handlers. */
export interface CollabRoomBinding {
  /** The acquired shared socket (feature emitters usually read `socketRef` instead). */
  socket: CollabSocket;
  /**
   * Register a server→client listener that the base auto-removes on cleanup.
   * The feature owns the handler's closed-over state/refs and clears them in the
   * optional cleanup it returns from `bindEvents`.
   */
  on: <E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) => void;
}

export interface CollabRoomState {
  isConnected: boolean;
  /** True once a `join` ack has succeeded on the current mount (reset on unmount). */
  isJoined: boolean;
  presentMembers: CollabRoomMember[];
  joinedRoom: string | null;
  /** The acquired shared socket ref — feature emitters read `.current` at emit time. */
  socketRef: MutableRefObject<CollabSocket | null>;
}

export interface UseCollabRoomOptions {
  /** Acquire the socket only while the surface is actually mounted/open (lazy). */
  enabled: boolean;
  /** The trusted room binding; the server derives clinicId + identity from it. */
  joinRequest: CollabJoinRequest;
  /**
   * Attach feature-specific server→client handlers on (re)acquire. Returns an
   * optional cleanup (clear timers, reset feature state) run on effect teardown.
   * Called ONLY when a socket was actually acquired (never in the degraded path).
   */
  bindEvents?: (binding: CollabRoomBinding) => (() => void) | void;
}

export function useCollabRoom({
  enabled,
  joinRequest,
  bindEvents,
}: UseCollabRoomOptions): CollabRoomState {
  const socketRef = useRef<CollabSocket | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  // Latest freshly-minted bearer token. The (sync) collab auth source re-reads
  // this on every (re)connect, so keeping it fresh keeps reconnects authorised.
  const tokenRef = useRef<string | null>(null);

  // Keep the binder fresh without re-running the connect effect (the base only
  // invokes the current binder once per acquire).
  const bindEventsRef = useRef(bindEvents);
  bindEventsRef.current = bindEvents;

  const [isConnected, setIsConnected] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [presentMembers, setPresentMembers] = useState<CollabRoomMember[]>([]);
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);

  // Re-run the connect effect only when the join binding actually changes — a
  // caller may pass a fresh `joinRequest` object literal every render.
  const kind = joinRequest.kind;
  const recordType = joinRequest.kind === "record" ? joinRequest.recordType : undefined;
  const recordId = joinRequest.kind === "record" ? joinRequest.recordId : undefined;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let acquired: CollabSocket | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let featureCleanup: (() => void) | void;
    const removeListeners: Array<() => void> = [];

    // Rebuild the request from the (dep-tracked) primitives so the effect never
    // closes over a stale caller object.
    const req: CollabJoinRequest =
      kind === "record"
        ? { kind: "record", recordType: recordType ?? "", recordId: recordId ?? "" }
        : kind === "board"
          ? { kind: "board" }
          : { kind: "chat" };

    /**
     * Fresh-token auth source. Re-read the latest minted token on every
     * (re)connect — never a static/stale snapshot. Returns null (→ degrade) when
     * no token is available (dev-bypass / signed-out).
     */
    const authSource: CollabAuthSource = () =>
      tokenRef.current ? { token: tokenRef.current } : null;

    // Re-emit join on EVERY (re)connect. socket.io rooms are per-connection and
    // reconnection is ON (Infinity), so after any WS blip the reconnected socket
    // has NO room membership — without re-joining, presence/feature events silently
    // die while isConnected stays true. Idempotent server-side. — panel #1 (HIGH).
    const doJoin = () => {
      const socket = socketRef.current;
      if (!socket) return;
      void joinCollabRoom(socket, req).then((ack) => {
        if (cancelled) return;
        if (ack?.ok) {
          if (ack.room) {
            joinedRoomRef.current = ack.room;
            setJoinedRoom(ack.room);
          }
          if (ack.members) setPresentMembers(ack.members);
          setIsJoined(true);
        }
      });
    };

    const handleConnect = () => {
      setIsConnected(true);
      doJoin();
    };
    const handleDisconnect = () => setIsConnected(false);

    const handlePresence = (payload: { room: string; members: CollabRoomMember[] }) => {
      // Drop presence for any room that is not THIS hook's joined room — on the
      // SHARED ref-counted socket a room-A event must not overwrite this hook's
      // room-B roster. This also drops presence during the pre-ack window (joined
      // room still null): the hook's own initial roster arrives via the join
      // ack.members, so nothing is lost by ignoring presence until the room is
      // known. — panel #3 (MEDIUM) + fix-delta re-review (pre-ack/failed-join window).
      if (payload?.room !== joinedRoomRef.current) return;
      setPresentMembers(Array.isArray(payload?.members) ? payload.members : []);
    };

    const register = <E extends keyof ServerToClientEvents>(
      event: E,
      handler: ServerToClientEvents[E],
    ) => {
      const socket = socketRef.current;
      if (!socket) return;
      // socket.io's listener type is a conditional mapped type TS cannot correlate
      // through a generic `E`; the public signature above keeps callers type-safe,
      // so bridge the on/off calls with a single localized (non-`any`) cast.
      type Bind = (e: string, h: (...args: unknown[]) => void) => void;
      const fn = handler as unknown as (...args: unknown[]) => void;
      (socket.on as unknown as Bind)(event, fn);
      removeListeners.push(() => (socket.off as unknown as Bind)(event, fn));
    };

    const connect = () => {
      if (cancelled) return;
      const socket = getCollabSocket(authSource);
      if (!socket) return; // degrade — no token / channel unavailable
      acquired = socket;
      socketRef.current = socket;

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      register("presence", handlePresence);

      featureCleanup = bindEventsRef.current?.({ socket, on: register });

      // If the socket is ALREADY connected when listeners are bound, the `connect`
      // event has already fired and handleConnect won't run — join once explicitly
      // now. Every later (re)connect re-runs doJoin via handleConnect. — panel #1.
      if (isCollabConnected()) {
        setIsConnected(true);
        doJoin();
      }
    };

    // Mint a FRESH token before the first connect (fixes the "opened past the token
    // TTL → expired handshake" bug), then re-mint on a cadence so the shared
    // socket's infinite reconnects always read a valid token.
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
      if (featureCleanup) featureCleanup();
      if (acquired) {
        acquired.off("connect", handleConnect);
        acquired.off("disconnect", handleDisconnect);
        for (const remove of removeListeners) remove();
        if (joinedRoomRef.current) leaveCollabRoom(acquired, joinedRoomRef.current);
        // Only release when a socket was actually acquired — a null (degraded)
        // getCollabSocket must NOT be paired with a release. — collab-socket contract.
        releaseCollabSocket();
      }
      joinedRoomRef.current = null;
      socketRef.current = null;
      tokenRef.current = null;
      setIsConnected(false);
      setIsJoined(false);
      setPresentMembers([]);
      setJoinedRoom(null);
    };
  }, [enabled, kind, recordType, recordId]);

  return { isConnected, isJoined, presentMembers, joinedRoom, socketRef };
}
