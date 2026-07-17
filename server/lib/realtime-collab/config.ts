/**
 * R-RTC-1 — collaboration WS channel configuration (isolated to this channel).
 *
 * The collaboration channel is a SEPARATE Socket.io transport carrying only
 * ephemeral signals (presence, typing, cursors). It never touches the frozen
 * SSE + `vt_event_outbox` domain/emergency path. Every knob that governs whether
 * and how it runs lives here so the isolation boundary is auditable in one file.
 */

/** Distinct path from `/api/realtime/*` (SSE) — a socket namespace of its own. */
export const COLLAB_SOCKET_PATH = "/collab-ws";

/** Redis key prefix + TTL for ephemeral presence leases (mirrors display-heartbeat-store). */
export const COLLAB_REDIS_PREFIX = "vettrack:collab:";
export const PRESENCE_TTL_MS = 90_000; // 3× the client heartbeat cadence
export const PRESENCE_HEARTBEAT_MS = 30_000;
/**
 * Extra life given to a room's presence ZSET *key* (via PEXPIRE) beyond the lease
 * TTL, so an ABANDONED room (a crashed/ungraceful instance whose members are never
 * ZREM'd and whose room is never read again) self-expires off the shared Redis
 * instead of lingering forever — the same self-expiring behavior the old per-key
 * `SET ... PX` had and that display-heartbeat-store's `SET ... EX` keeps. The margin
 * is > 0 so the key always outlives its newest member's score; read-time
 * ZREMRANGEBYSCORE still governs membership within the key's lifetime.
 */
export const PRESENCE_KEY_EXPIRE_MARGIN_MS = 10_000;

/** Bounded in-process fallback caps (no unbounded growth when Redis is absent). */
export const FALLBACK_MAP_MAX_ROOMS = 2_000;
export const FALLBACK_MAP_MAX_LEASES_PER_ROOM = 500;

/** Server-enforced rate limits (in addition to the client throttle) — R-RTC-1.3. */
export const CURSOR_MAX_PER_SEC = 20;
export const SELECTION_MAX_PER_SEC = 5;
export const BOARD_ROOM_AGGREGATE_MAX_PER_SEC = 500;
export const MAX_EVENT_BYTES = 2_048;
/** A socket bursting this far beyond its per-second budget is disconnected. */
export const RATE_DISCONNECT_MULTIPLIER = 5;

/**
 * Per-socket rate limits for the non-board control events (R-RTC-1 DoS hardening,
 * card H2). `join` is throttled BEFORE its DB round-trip; `chat-nudge` is kept low
 * because each accepted nudge fans out to every clinic member (amplification). Over
 * budget → the event is dropped (join acks `RATE_LIMITED`, the others silently drop).
 */
export const JOIN_MAX_PER_SEC = 30;
export const TYPING_MAX_PER_SEC = 10;
export const NUDGE_MAX_PER_SEC = 5;
export const RECORD_PRESENCE_MAX_PER_SEC = 10;
export const LEAVE_MAX_PER_SEC = 20;
/**
 * Per-socket cap on `presence-heartbeat`. Kept small: a single heartbeat fans
 * `presence.refresh` (Redis ZADD + PEXPIRE) across EVERY room the socket holds, so
 * an unthrottled flood amplifies into the shared Redis. The legitimate client cadence
 * is one heartbeat per PRESENCE_HEARTBEAT_MS (30 s), so 4/s is far above real use.
 */
export const HEARTBEAT_MAX_PER_SEC = 4;

/**
 * Hard cap on how many rooms a single socket may hold at once (R-RTC-1 card H2).
 * Bounds `socket.data.rooms`; a join that would exceed it is rejected with
 * `ROOM_LIMIT_EXCEEDED`. Kept below JOIN_MAX_PER_SEC so the cap is reachable within
 * one rate window (a legitimate client joins far fewer rooms than this).
 */
export const MAX_ROOMS_PER_SOCKET = 20;

/**
 * Explicit disable switch (R-RTC-1.7). Default-enabled, but any of these turns the
 * whole channel off cleanly. `COLLAB_WS_ENABLED=false` is the documented kill switch.
 */
export function isCollabEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.COLLAB_WS_ENABLED ?? "").toLowerCase() === "false") return false;
  return true;
}

/**
 * Explicit single-instance dev opt-in. In production the channel REQUIRES Redis
 * (fans rooms across instances); a bounded in-process fallback is permitted only
 * when this is set, so a genuine single-instance prod deployment is an explicit
 * choice — never a silent divergent-presence fallback (R-RTC-1.5).
 */
export function allowsInProcessFallback(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true; // dev/test always may
  return (env.COLLAB_WS_ALLOW_SINGLE_INSTANCE ?? "").toLowerCase() === "true";
}

/**
 * The Origin allowlist for the CSWSH defense (R-RTC-1.1). A handshake from an
 * origin not on this list is rejected BEFORE the session is validated. Capacitor
 * native origins are included (the app's own shell), plus configured web origins.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const configured = (env.COLLAB_WS_ALLOWED_ORIGINS ?? env.APP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const capacitor = ["capacitor://localhost", "https://localhost", "http://localhost"];
  const dev = env.NODE_ENV !== "production"
    ? ["http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:3001", "http://127.0.0.1:3001"]
    : [];
  return [...configured, ...capacitor, ...dev];
}

/**
 * Is `origin` trusted? An ABSENT Origin header is allowed only in non-production
 * (native WebViews and some test clients omit it); production requires a match.
 */
export function isOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (origin === undefined || origin === "") {
    return env.NODE_ENV !== "production";
  }
  return allowedOrigins(env).includes(origin);
}
