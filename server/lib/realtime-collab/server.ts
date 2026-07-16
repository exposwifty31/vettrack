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
} from "./config.js";
import { validateHandshake } from "./handshake.js";
import { resolveHandshakeIdentity } from "./identity.js";
import {
  authorizeRoomJoin,
  boardRoom,
  chatRoom,
  type CollabIdentity,
  type JoinRequest,
  type RecordAccessCheck,
} from "./rooms.js";
import { defaultRecordAccessCheck } from "./record-access.js";
import { createPresenceStore, type PresenceStore } from "./presence-store.js";
import { createRateLimiter, isNormalizedCoord, isWithinByteLimit } from "./rate-limit.js";
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
  const rateLimiter = createRateLimiter();

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

  // Redis adapter for cross-instance fan-out. Prod REQUIRES it (fail the channel
  // loudly, never the process) unless single-instance is an explicit dev/opt-in.
  if (!opts.skipRedisAdapter) {
    try {
      const redis = await getRedis();
      if (redis) {
        const { createAdapter } = await import("@socket.io/redis-adapter");
        const sub = redis.duplicate();
        io.adapter(createAdapter(redis, sub));
      } else if (!allowsInProcessFallback()) {
        console.error(
          "[collab-ws] Redis required in production but unavailable — collaboration channel DISABLED. " +
            "Set COLLAB_WS_ALLOW_SINGLE_INSTANCE=true only for a genuine single-instance deployment.",
        );
        await io.close();
        return { enabled: false, reason: "REDIS_REQUIRED", async close() {} };
      } else {
        console.warn("[collab-ws] No Redis — single-instance in-process fan-out (explicit opt-in).");
      }
    } catch (err) {
      console.error("[collab-ws] Redis adapter wiring failed — channel disabled (non-fatal)", err);
      await io.close();
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

    const emitPresence = (room: string) => {
      io.to(room).emit("presence", { room, members: presence.getPresent(room) });
    };

    socket.on("join", async (req: JoinRequest, ack?: (r: unknown) => void) => {
      const decision = await authorizeRoomJoin(identity, req, recordAccess);
      if (!decision.ok) {
        ack?.({ ok: false, reason: decision.reason });
        return;
      }
      await socket.join(decision.room);
      socket.data.rooms.add(decision.room);
      if (presence.addLease(decision.room, { userId: identity.userId, displayName: identity.displayName }, socket.id)) {
        recordCollabMetric("collab_presence");
      }
      emitPresence(decision.room);
      ack?.({ ok: true, room: decision.room, members: presence.getPresent(decision.room) });
    });

    // ── Feature 1: shift-chat typing + presence + nudge (R-RTC-1.2) ────────────
    socket.on("typing", (payload: { on?: boolean }) => {
      const room = chatRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
      recordCollabMetric("collab_typing");
      // Identity is server-attached; a client-supplied userId is never read.
      socket.to(room).emit("peer-typing", { userId: identity.userId, on: payload?.on === true });
    });

    socket.on("presence-heartbeat", () => {
      for (const room of socket.data.rooms) presence.touch(room, socket.id);
    });

    socket.on("chat-nudge", (payload: { messageId?: string }) => {
      const room = chatRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
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
      const perSocket = rateLimiter.check(`cur:${socket.id}`, CURSOR_MAX_PER_SEC);
      const perRoom = rateLimiter.check(`curroom:${room}`, BOARD_ROOM_AGGREGATE_MAX_PER_SEC);
      if (perSocket === "disconnect") {
        recordCollabMetric("collab_board_rate_limited");
        socket.disconnect(true);
        return;
      }
      if (perSocket === "drop" || perRoom !== "allow") {
        recordCollabMetric("collab_cursor_dropped");
        return;
      }
      socket.to(room).emit("peer-cursor", { userId: identity.userId, x: payload.x, y: payload.y });
    });

    socket.on("board-selection", (payload: { entityId?: unknown }) => {
      const room = boardRoom(identity.clinicId);
      if (!socket.data.rooms.has(room)) return;
      if (typeof payload?.entityId !== "string" || payload.entityId.length > 128) return;
      if (rateLimiter.check(`sel:${socket.id}`, SELECTION_MAX_PER_SEC) !== "allow") {
        recordCollabMetric("collab_board_rate_limited");
        return;
      }
      socket.to(room).emit("peer-selection", { userId: identity.userId, entityId: payload.entityId });
    });

    // ── Feature 3: record co-presence (advisory) (R-RTC-1.4) ───────────────────
    socket.on("record-presence", (payload: { editing?: boolean }) => {
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

    socket.on("leave", (payload: { room?: string }) => {
      const room = typeof payload?.room === "string" ? payload.room : "";
      if (!socket.data.rooms.has(room)) return;
      socket.leave(room);
      socket.data.rooms.delete(room);
      presence.removeLease(room, socket.id);
      emitPresence(room);
    });

    socket.on("disconnect", () => {
      recordCollabMetric("collab_ws_disconnected");
      for (const room of socket.data.rooms) {
        presence.removeLease(room, socket.id);
        emitPresence(room);
      }
      rateLimiter.reset(`cur:${socket.id}`);
      rateLimiter.reset(`sel:${socket.id}`);
    });
  });

  console.log(`[collab-ws] collaboration channel active on ${COLLAB_SOCKET_PATH}`);
  return {
    enabled: true,
    io,
    async close() {
      await io.close();
    },
  };
}
