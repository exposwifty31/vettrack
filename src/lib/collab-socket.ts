/**
 * R-RTC-1.6 — thin, lazy `socket.io-client` wrapper for the collaboration channel.
 *
 * Connected LAZILY only on surfaces that use it (shift-chat panel, `/board`,
 * record-detail) — never app-wide. Auto-reconnect. Graceful degradation is the
 * caller's contract: if the socket never connects (Capacitor native, restrictive
 * network, channel disabled) the using surface simply shows no peer signals —
 * NO core action is ever gated on this socket.
 *
 * Identity is server-attached from the DB session; this client sends only the
 * bearer token (and, in dev-bypass, the role override) in `auth`. It never claims
 * a userId — the server ignores client-claimed identity.
 *
 * Lifecycle (card H1): the single socket is a SHARED singleton reference-counted
 * across consumers. `getCollabSocket` acquires (one ref); `releaseCollabSocket`
 * releases and disconnects ONLY when the last holder lets go — a single consumer
 * unmount must never disconnect the socket out from under other mounted surfaces.
 * `closeCollabSocket` is the hard sign-out teardown (drops all refs at once).
 */
import { io, type Socket } from "socket.io-client";
import { getConfiguredApiOrigin, needsRemoteApiOrigin } from "@/lib/api-origin";

const COLLAB_PATH = "/collab-ws";
const JOIN_ACK_TIMEOUT_MS = 5_000;
/**
 * Client presence-heartbeat cadence. The server prunes a socket's presence lease
 * after `PRESENCE_TTL_MS = 90_000` (`server/lib/realtime-collab/config.ts`) unless
 * refreshed via `presence-heartbeat`; 30s sits comfortably under that TTL. ONE
 * heartbeat per SHARED socket refreshes ALL of its rooms' leases server-side, so
 * this belongs in the primitive — a per-hook heartbeat would multi-emit.
 */
const COLLAB_HEARTBEAT_MS = 30_000;

/**
 * A join request as the client asks for it — SHARED shape with the server's
 * `JoinRequest` (`server/lib/realtime-collab/rooms.ts`). The server derives the
 * clinicId from the authenticated session; the client never supplies one.
 */
export type CollabJoinRequest =
  | { kind: "chat" }
  | { kind: "board" }
  | { kind: "proposal-queue" }
  | { kind: "record"; recordType: string; recordId: string };

/** The server's join ack (mirrors the `authorizeRoomJoin` decision + presence). */
export interface CollabJoinAck {
  ok: boolean;
  room?: string;
  members?: { userId: string; displayName: string }[];
  reason?: string;
}

/** Server → client events (mirrors `server/lib/realtime-collab/server.ts` emits). */
export interface ServerToClientEvents {
  presence: (payload: { room: string; members: { userId: string; displayName: string }[] }) => void;
  "peer-typing": (payload: { userId: string; on: boolean }) => void;
  "chat-nudge": (payload: { messageId: string }) => void;
  "peer-cursor": (payload: { userId: string; x: number; y: number }) => void;
  "peer-selection": (payload: { userId: string; entityId: string }) => void;
  "peer-record": (payload: { userId: string; mode: "editing" | "viewing" }) => void;
  /**
   * VetTrack 2.0, Task 1.1 §1.5 (option 1, nudge-only) — advisory-only "the
   * approval queue changed, go refetch" ping. NEVER carries proposal
   * content (id/kind/summary/citations/status) — the payload is always
   * exactly `{ kind: "proposal_queue_changed" }`. Consumers refetch via the
   * authenticated REST path (`api.actionProposals.list`); this event alone
   * is never treated as the source of truth for queue state.
   */
  "proposal-queue-changed": (payload: { kind: "proposal_queue_changed" }) => void;
}

/** Client → server events (mirrors the server's `socket.on(...)` handlers). */
export interface ClientToServerEvents {
  join: (req: CollabJoinRequest, ack: (res: CollabJoinAck) => void) => void;
  leave: (payload: { room: string }) => void;
  typing: (payload: { on: boolean }) => void;
  "presence-heartbeat": () => void;
  "chat-nudge": (payload: { messageId: string }) => void;
  "board-cursor": (payload: { x: number; y: number }) => void;
  "board-selection": (payload: { entityId: string }) => void;
  "record-presence": (payload: { editing: boolean }) => void;
}

/** The typed collaboration socket callers hold. */
export type CollabSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface CollabAuth {
  /** Clerk session token (bearer). In dev-bypass any non-empty placeholder works. */
  token: string;
  /** Dev-bypass overrides — ignored by the server unless it is in dev-bypass mode. */
  dev?: { role?: string; userId?: string; clinicId?: string };
}

/**
 * Auth source — either a static value or a getter re-read on every (re)connect.
 * Prefer the getter form so a refreshed session token is used on reconnect rather
 * than replaying the original (possibly expired) token forever. — card H6.
 */
export type CollabAuthSource = CollabAuth | (() => CollabAuth | null);

function resolveAuth(source: CollabAuthSource): CollabAuth | null {
  const auth = typeof source === "function" ? source() : source;
  if (!auth || !auth.token) return null;
  return auth;
}

/**
 * Resolve the origin the collab socket connects to. `window.location.origin` is
 * dead in the Capacitor bundled shell (`capacitor://localhost`), so reuse the
 * same remote-origin resolution the REST client uses. — card H4.
 */
function resolveCollabOrigin(): string {
  if (needsRemoteApiOrigin()) {
    const configured = getConfiguredApiOrigin();
    if (configured) return configured;
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}

let socket: CollabSocket | null = null;
let refCount = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Registry of the ACTIVE auth providers on the SHARED socket. The `io()` auth
 * callback closes over THIS set, not over the first acquirer's source — so when
 * the first consumer releases while peers remain, its (now stale/null) token is
 * NOT replayed on reconnect; a still-active consumer's fresh token is resolved
 * instead. Each acquire adds its source; each release removes it; a hard close
 * clears all. — multi-consumer auth-capture fix (extends card H6).
 */
const activeAuthSources = new Set<CollabAuthSource>();

/**
 * Start the single presence-heartbeat interval for the shared socket. Idempotent.
 * Emits ONLY while the socket is connected (a queued emit on a down socket would be
 * pointless) — graceful degradation stays intact: no heartbeat, no error, no gated
 * action. The event carries NO payload; identity is server-attached.
 */
function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (socket?.connected) socket.emit("presence-heartbeat");
  }, COLLAB_HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Acquire the shared collaboration socket (lazily creating it). Increments the
 * ref count; the caller MUST pair each successful acquire with a
 * `releaseCollabSocket()`. Returns null when no auth token is available — callers
 * must treat null as "degrade, show no peer signals" (and must NOT release).
 */
export function getCollabSocket(auth: CollabAuthSource | null, origin?: string): CollabSocket | null {
  if (auth === null) return null;
  if (!resolveAuth(auth)) return null;

  // Register this consumer's source among the ACTIVE providers on the shared socket.
  activeAuthSources.add(auth);

  if (socket) {
    refCount += 1;
    return socket;
  }

  socket = io(origin ?? resolveCollabOrigin(), {
    path: COLLAB_PATH,
    transports: ["websocket"],
    // Auth is a CALLBACK so each (re)connect reads a FRESH token instead of
    // replaying the original one forever under reconnectionAttempts: Infinity (— H6).
    // It resolves the FIRST still-ACTIVE registered source that yields a non-empty
    // token, skipping released/null ones — a released first acquirer must never
    // fail reconnect auth for peers that still hold fresh tokens.
    auth: (cb: (data: Record<string, unknown>) => void) => {
      for (const source of activeAuthSources) {
        const resolved = resolveAuth(source);
        if (resolved?.token) {
          cb({ token: resolved.token, dev: resolved.dev });
          return;
        }
      }
      cb({ token: "" });
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    autoConnect: true,
  }) as CollabSocket;
  refCount = 1;
  startHeartbeat();
  return socket;
}

/** True when a socket exists and is currently connected. */
export function isCollabConnected(): boolean {
  return socket?.connected === true;
}

function isJoinAck(value: unknown): value is CollabJoinAck {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

/** Join a collaboration room; resolves with the ack (or null on timeout/bad ack). */
export function joinCollabRoom(s: CollabSocket, req: CollabJoinRequest): Promise<CollabJoinAck | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null); // degrade silently — no peer presence shown
      }
    }, JOIN_ACK_TIMEOUT_MS);
    s.emit("join", req, (ack: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(isJoinAck(ack) ? ack : null);
    });
  });
}

/**
 * Leave a single collaboration room WITHOUT tearing down the shared socket — a
 * consumer that navigates away from one surface (e.g. a record detail) leaves its
 * room but other mounted surfaces keep the connection. — card H1.
 */
export function leaveCollabRoom(s: CollabSocket, room: string): void {
  s.emit("leave", { room });
}

/**
 * Release one acquire. Disconnects and clears the singleton ONLY when the last
 * holder releases (ref count reaches zero). A single consumer unmount must never
 * disconnect the socket out from under other mounted consumers. — card H1.
 */
export function releaseCollabSocket(source?: CollabAuthSource | null): void {
  // Drop this consumer's auth source from the ACTIVE registry so a later reconnect
  // never resolves a released consumer's (stale/null) token. — multi-consumer fix.
  if (source) activeAuthSources.delete(source);
  if (!socket) return;
  refCount -= 1;
  if (refCount <= 0) {
    stopHeartbeat();
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    refCount = 0;
    activeAuthSources.clear();
  }
}

/**
 * Hard teardown — drops ALL refs and disconnects immediately. Use for sign-out,
 * NOT for per-surface unmount (that is `releaseCollabSocket`). — card H1.
 */
export function closeCollabSocket(): void {
  stopHeartbeat();
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  refCount = 0;
  activeAuthSources.clear();
}
