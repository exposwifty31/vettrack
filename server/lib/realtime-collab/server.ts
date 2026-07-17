/**
 * R-RTC-1 — collaboration Socket.io server (init + connection handlers).
 *
 * Isolated, ephemeral-only channel. It shares the HTTP server but lives on a
 * DISTINCT path (`/collab-ws`) from the SSE endpoints. It NEVER carries domain or
 * emergency state, and its entire initialization is non-fatal to the main server
 * (R-RTC-1.7): any failure here logs and leaves the channel disabled while SSE,
 * `vt_event_outbox`, and Code Blue start normally.
 */
import type { Server as HttpServer } from "http";
import { Server, type Socket, type DefaultEventsMap } from "socket.io";
import type { Redis } from "ioredis";
import { getRedis } from "../redis.js";
import {
  COLLAB_SOCKET_PATH,
  isCollabEnabled,
  allowsInProcessFallback,
  allowedOrigins,
  CURSOR_MAX_PER_SEC,
  SELECTION_MAX_PER_SEC,
  BOARD_ROOM_AGGREGATE_MAX_PER_SEC,
  MAX_EVENT_BYTES,
  JOIN_MAX_PER_SEC,
  TYPING_MAX_PER_SEC,
  NUDGE_MAX_PER_SEC,
  RECORD_PRESENCE_MAX_PER_SEC,
  LEAVE_MAX_PER_SEC,
  HEARTBEAT_MAX_PER_SEC,
  MAX_ROOMS_PER_SOCKET,
} from "./config.js";
import { validateHandshake } from "./handshake.js";
import { resolveHandshakeIdentity } from "./identity.js";
import {
  authorizeRoomJoin,
  boardRoom,
  chatRoom,
  type CollabIdentity,
  type RecordAccessCheck,
} from "./rooms.js";
import { defaultRecordAccessCheck } from "./record-access.js";
import { createPresenceStore, type PresenceStore } from "./presence-store.js";
import {
  createRateLimiter,
  isNormalizedCoord,
  isWithinByteLimit,
  socketRateKey,
  socketRateKeyPrefix,
  COLLAB_RATE_VERBS,
  type RateLimiter,
} from "./rate-limit.js";
import { recordCollabMetric } from "./telemetry.js";

export interface CollabServer {
  enabled: boolean;
  reason?: string;
  io?: Server;
  close(): Promise<void>;
}

interface SocketData {
  identity: CollabIdentity;
  rooms: Set<string>;
}
type CollabSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

export interface InitCollabOptions {
  recordAccess?: RecordAccessCheck;
  presence?: PresenceStore;
  /** Test seam: skip the real Redis adapter wiring. */
  skipRedisAdapter?: boolean;
  /** Test seam: inject the handshake identity resolver (defaults to the DB path). */
  resolveIdentity?: typeof resolveHandshakeIdentity;
  /** Test seam: inject the Redis client factory (defaults to the shared getRedis). */
  getRedisClient?: () => Promise<Redis | null>;
  /** Test seam: inject the rate limiter (defaults to a fresh in-process one). */
  rateLimiter?: RateLimiter;
}

/**
 * Initialize the collaboration channel on `httpServer`. Always resolves — never
 * throws — so the caller can treat it as strictly additive.
 */
export async function initCollabServer(
  httpServer: HttpServer,
  opts: InitCollabOptions = {},
): Promise<CollabServer> {
  if (!isCollabEnabled()) {
    return { enabled: false, reason: "COLLAB_WS_ENABLED=false", async close() {} };
  }

  const presence = opts.presence ?? createPresenceStore();
  const recordAccess = opts.recordAccess ?? defaultRecordAccessCheck;
  const rateLimiter = opts.rateLimiter ?? createRateLimiter();
  const getRedisClient = opts.getRedisClient ?? getRedis;

  let io: Server;
  try {
    io = new Server(httpServer, {
      path: COLLAB_SOCKET_PATH,
      transports: ["websocket"], // avoid sticky-session affinity on Railway
      cors: { origin: allowedOrigins() as string[], credentials: false },
      maxHttpBufferSize: MAX_EVENT_BYTES * 4,
    });
  } catch (err) {
    console.error("[collab-ws] Socket.io init failed — channel disabled (non-fatal)", err);
    return { enabled: false, reason: "SOCKET_INIT_FAILED", async close() {} };
  }

  // Teardown that NEVER stops the shared http.Server. `io.close()` internally calls
  // `httpServer.close()`, which would tear down the SHARED production server that
  // Express + SSE + Code Blue run on. Instead we only disconnect collab sockets and
  // close the engine (the WS layer), and quit the Redis-adapter sub connection — the
  // shared server stays up. This runs on every disable branch AND on graceful close,
  // preserving the R-RTC-1.7 non-fatal invariant.
  let adapterSub: Redis | undefined;
  const teardown = async (): Promise<void> => {
    try {
      io.disconnectSockets(true);
      io.engine.close();
    } catch (err) {
      console.error("[collab-ws] teardown error (non-fatal)", err);
    }
    if (adapterSub) {
      try {
        await adapterSub.quit();
      } catch (err) {
        // best-effort — a sub that never fully connected may reject on quit. Surface it
        // (a swallowed quit leaks the subscriber) without failing teardown. — PR#112 (d).
        console.warn("[collab-ws] adapterSub quit failed during teardown (non-fatal)", err);
      }
      adapterSub = undefined;
    }
  };

  // Redis adapter for cross-instance fan-out. Prod REQUIRES it (fail the channel
  // loudly, never the process) unless single-instance is an explicit dev/opt-in.
  if (!opts.skipRedisAdapter) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        const { createAdapter } = await import("@socket.io/redis-adapter");
        const sub = redis.duplicate();
        adapterSub = sub;
        io.adapter(createAdapter(redis, sub));
      } else if (!allowsInProcessFallback()) {
        console.error(
          "[collab-ws] Redis required in production but unavailable — collaboration channel DISABLED. " +
            "Set COLLAB_WS_ALLOW_SINGLE_INSTANCE=true only for a genuine single-instance deployment.",
        );
        await teardown();
        return { enabled: false, reason: "REDIS_REQUIRED", async close() {} };
      } else {
        console.warn("[collab-ws] No Redis — single-instance in-process fan-out (explicit opt-in).");
      }
    } catch (err) {
      console.error("[collab-ws] Redis adapter wiring failed — channel disabled (non-fatal)", err);
      await teardown();
      return { enabled: false, reason: "REDIS_ADAPTER_FAILED", async close() {} };
    }
  }

  // ── Handshake auth (R-RTC-1.1) ──────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      // Browser WebSocket handshakes cannot set custom headers — the bearer token
      // and dev-bypass overrides ride in `handshake.auth` (which the browser CAN
      // set). The Origin header IS sent automatically by the WS handshake.
      const auth = (socket.handshake.auth ?? {}) as {
        token?: string;
        userId?: unknown;
        dev?: { role?: string; userId?: string; clinicId?: string };
      };
      const result = await validateHandshake(
        {
          origin: socket.handshake.headers.origin,
          authToken: auth.token,
          claimedUserId: auth.userId,
          devHeaders: {
            "x-dev-role-override": auth.dev?.role,
            "x-dev-user-id-override": auth.dev?.userId,
            "x-dev-clinic-id-override": auth.dev?.clinicId,
          },
        },
        opts.resolveIdentity ?? resolveHandshakeIdentity,
      );
      if (!result.ok) return next(new Error(result.reason));
      (socket.data as SocketData).identity = result.identity;
      (socket.data as SocketData).rooms = new Set();
      next();
    } catch (err) {
      console.error("[collab-ws] handshake error", err);
      next(new Error("HANDSHAKE_FAILED"));
    }
  });

  io.on("connection", (socket: CollabSocket) => {
    const { identity } = socket.data;
    recordCollabMetric("collab_ws_connected");

    const emitPresence = async (room: string) => {
      // Converged (cross-instance) member list — the local view alone diverges under
      // the 2-instance topology the channel requires Redis for (card H5).
      io.to(room).emit("presence", { room, members: await presence.getConvergedPresent(room) });
    };

    socket.on("join", async (req: unknown, ack?: (r: unknown) => void) => {
      // The whole body is wrapped: authorizeRoomJoin awaits the record ACL, which is a
      // REAL db.select. A transient DB rejection would otherwise escape this async
      // listener as an unhandled rejection AND never ack (the client hangs forever).
      // Catch → log → ack a stable JOIN_FAILED so the client fails fast. — PR#112 (a).
      try {
        // Rate-limit BEFORE authorization — a join is a DB round-trip (record ACL),
        // so throttling here caps the DB work a misbehaving socket can force. — H2.
        if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.join), JOIN_MAX_PER_SEC) !== "allow") {
          ack?.({ ok: false, reason: "RATE_LIMITED" });
          return;
        }
        const decision = await authorizeRoomJoin(identity, req, recordAccess);
        if (!decision.ok) {
          ack?.({ ok: false, reason: decision.reason });
          return;
        }
        // Bound socket.data.rooms so it can't grow without limit (a distinct room per
        // join otherwise accumulates forever). Re-joining a held room is always ok. — H2.
        if (!socket.data.rooms.has(decision.room) && socket.data.rooms.size >= MAX_ROOMS_PER_SOCKET) {
          ack?.({ ok: false, reason: "ROOM_LIMIT_EXCEEDED" });
          return;
        }
        await socket.join(decision.room);
        socket.data.rooms.add(decision.room);
        if (await presence.register(decision.room, { userId: identity.userId, displayName: identity.displayName }, socket.id)) {
          recordCollabMetric("collab_presence");
        }
        await emitPresence(decision.room);
        ack?.({ ok: true, room: decision.room, members: await presence.getConvergedPresent(decision.room) });
      } catch (err) {
        console.error("[collab-ws] room join failed", { socketId: socket.id, err });
        ack?.({ ok: false, reason: "JOIN_FAILED" });
      }
    });

    // ── Feature 1: shift-chat typing + presence + nudge (R-RTC-1.2) ────────────
    socket.on("typing", (payload: { on?: boolean }) => {
      const room = chatRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
      if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.typing), TYPING_MAX_PER_SEC) !== "allow") return;
      recordCollabMetric("collab_typing");
      // Identity is server-attached; a client-supplied userId is never read.
      socket.to(room).emit("peer-typing", { userId: identity.userId, on: payload?.on === true });
    });

    socket.on("presence-heartbeat", () => {
      // Rate-limit BEFORE the room iteration: a single heartbeat fans presence.refresh
      // (Redis ZADD + PEXPIRE) across EVERY joined room, so an unthrottled flood
      // amplifies into the shared Redis. Gate it like every other control verb. — PR#112 (b).
      if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.heartbeat), HEARTBEAT_MAX_PER_SEC) !== "allow") return;
      // Refresh both the local lease and its Redis mirror TTL (best-effort, never throws).
      for (const room of socket.data.rooms) void presence.refresh(room, socket.id);
    });

    socket.on("chat-nudge", (payload: { messageId?: string }) => {
      const room = chatRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
      // Each accepted nudge fans out to every clinic member (each then refetches) —
      // throttle hard to bound that amplification. — H2.
      if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.nudge), NUDGE_MAX_PER_SEC) !== "allow") return;
      // Advisory refetch nudge only — WS never stores messages. The messageId lets
      // the client coalesce repeated emissions into one refetch.
      socket.to(room).emit("chat-nudge", { messageId: String(payload?.messageId ?? "") });
    });

    // ── Feature 2: board cursors/presence/selection (R-RTC-1.3) ────────────────
    socket.on("board-cursor", (payload: { x?: unknown; y?: unknown }) => {
      const room = boardRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
      if (!isNormalizedCoord(payload?.x) || !isNormalizedCoord(payload?.y)) return;
      if (!isWithinByteLimit(payload, MAX_EVENT_BYTES)) return;
      // Resolve the per-socket verdict FIRST and early-return on disconnect/drop. Only
      // AFTER a cursor passes its own budget do we charge the shared per-ROOM aggregate.
      // rateLimiter.check INCREMENTS on every call, so checking the room aggregate before
      // the per-socket drop verdict would let one abuser (already over its own budget)
      // still consume the room allowance and starve peers' cursors. — PR#112 (c).
      const perSocket = rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.cursor), CURSOR_MAX_PER_SEC);
      if (perSocket === "disconnect") {
        recordCollabMetric("collab_board_rate_limited");
        socket.disconnect(true);
        return;
      }
      if (perSocket === "drop") {
        recordCollabMetric("collab_cursor_dropped");
        return;
      }
      // Per-ROOM aggregate — shared across sockets, so it is NOT socket-namespaced and
      // must survive any single socket's disconnect cleanup. Charged only for a cursor
      // that already cleared its per-socket budget.
      if (rateLimiter.check(`curroom:${room}`, BOARD_ROOM_AGGREGATE_MAX_PER_SEC) !== "allow") {
        recordCollabMetric("collab_cursor_dropped");
        return;
      }
      socket.to(room).emit("peer-cursor", { userId: identity.userId, x: payload.x, y: payload.y });
    });

    socket.on("board-selection", (payload: { entityId?: unknown }) => {
      const room = boardRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
      if (typeof payload?.entityId !== "string" || payload.entityId.length > 128) return;
      if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.selection), SELECTION_MAX_PER_SEC) !== "allow") {
        recordCollabMetric("collab_board_rate_limited");
        return;
      }
      socket.to(room).emit("peer-selection", { userId: identity.userId, entityId: payload.entityId });
    });

    // ── Feature 3: record co-presence (advisory) (R-RTC-1.4) ───────────────────
    socket.on("record-presence", (payload: { editing?: boolean }) => {
      if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.recordPresence), RECORD_PRESENCE_MAX_PER_SEC) !== "allow") return;
      // recordType/recordId are DERIVED from the socket's authorized record rooms —
      // never from the client payload. Advisory only; never gates the OCC guard.
      for (const room of socket.data.rooms) {
        if (!room.includes(":record:")) continue;
        recordCollabMetric("collab_record_presence");
        socket.to(room).emit("peer-record", {
          userId: identity.userId,
          mode: payload?.editing === true ? "editing" : "viewing",
        });
      }
    });

    socket.on("leave", async (payload: { room?: string }) => {
      if (rateLimiter.check(socketRateKey(socket.id, COLLAB_RATE_VERBS.leave), LEAVE_MAX_PER_SEC) !== "allow") return;
      const room = typeof payload?.room === "string" ? payload.room : "";
      if (!socket.data.rooms.has(room)) return;
      socket.leave(room);
      socket.data.rooms.delete(room);
      await presence.unregister(room, socket.id);
      await emitPresence(room);
    });

    socket.on("disconnect", async () => {
      recordCollabMetric("collab_ws_disconnected");
      for (const room of socket.data.rooms) {
        await presence.unregister(room, socket.id);
        await emitPresence(room);
      }
      // Every per-socket rate-limit key is namespaced `${socket.id}:${verb}`, so this ONE
      // prefix-clear drops them all — a future verb can never leak a windows-Map key
      // through a forgotten per-verb reset. (The per-room `curroom:<room>` aggregate is
      // deliberately not socket-scoped and is untouched here.)
      rateLimiter.reset(socketRateKeyPrefix(socket.id));
    });
  });

  console.log(`[collab-ws] collaboration channel active on ${COLLAB_SOCKET_PATH}`);
  return {
    enabled: true,
    io,
    close: teardown,
  };
}
