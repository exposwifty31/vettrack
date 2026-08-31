/**
 * NODE-Z (Sentry: 270 occurrences, first seen 2026-07-17, still firing ~3s after
 * every boot) — the Redis adapter's REAL startup failure is ASYNCHRONOUS, and the
 * R-RTC-1.7 non-fatal invariant does not hold for it.
 *
 * `server/lib/redis.ts` builds every client with `enableOfflineQueue: false`, and
 * `redis.duplicate()` returns a SEPARATE, still-connecting client. The
 * `RedisAdapter` constructor issues `psubscribe` and `subscribe` IMMEDIATELY, so on
 * a cold subscriber ioredis REJECTS those commands rather than queueing them
 * ("Stream isn't writeable and enableOfflineQueue options is false"). It never
 * awaits or catches either promise, so the rejection is invisible to the
 * synchronous `try/catch` around the wiring — the constructor already returned. It
 * escapes to `process.on("unhandledRejection")` (server/index.ts:2), which demotes
 * it to a console line.
 *
 * The consequence is the OPPOSITE of what this module's docblock promises. The
 * catch never runs, so `teardown()` never runs and `REDIS_ADAPTER_FAILED` is never
 * returned: `initCollabServer` reports `enabled: true` while its cross-instance
 * fan-out is dead. "Logs and leaves the channel disabled" is, on this path,
 * "logs and leaves the channel enabled and broken".
 *
 * `collab-emergency-isolation.test.ts` already covers this branch — with a
 * `duplicate()` that throws SYNCHRONOUSLY, which the try/catch does see. That is
 * the one failure mode production does not produce. These three cases cover the
 * one it does: the cause (adapter built on a cold client), the symptom Sentry
 * reports (an unhandled rejection), and the invariant that broke (enabled:true).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import type { Redis } from "ioredis";
import { initCollabServer } from "../server/lib/realtime-collab/server.js";

const COLD_COMMAND_ERROR = "Stream isn't writeable and enableOfflineQueue options is false";

/**
 * Exactly the ioredis surface this code path touches — `status` and the event
 * methods `waitUntilReady` reads, the two commands `RedisAdapter`'s constructor
 * issues, and what `teardown()` calls — typed against the REAL `Redis`.
 *
 * Typing it this way is the point: a double declared `as never` compiles against
 * anything, so an ioredis or adapter signature change would leave this suite
 * green while the integration it claims to pin had already broken.
 */
type AdapterFacingRedis = Pick<Redis, "status" | "psubscribe" | "subscribe" | "quit" | "disconnect"> &
  Pick<EventEmitter, "on" | "off" | "emit">;

type FakeSub = AdapterFacingRedis & {
  /** The client's status at the moment the adapter issued its first command. */
  statusAtFirstCommand: string | null;
};

type FakePub = Pick<Redis, "status" | "duplicate" | "quit"> & Pick<EventEmitter, "on" | "off" | "emit">;

/**
 * ONE boundary cast, isolated and explained. `getRedisClient` is typed
 * `() => Promise<Redis | null>`, and no partial double can satisfy ioredis's full
 * class surface (private fields included). Everything the code under test
 * actually touches is checked above by `AdapterFacingRedis` / `FakePub`; this
 * only widens that checked surface to the nominal type at the injection point.
 */
function asRedisClient(client: FakePub): Redis {
  return client as unknown as Redis;
}

/**
 * An ioredis-shaped subscriber that behaves like the real one under
 * `enableOfflineQueue: false`: commands issued before `ready` reject, commands
 * issued after it resolve. Deliberately has no `pSubscribe` (capital S) so
 * `createAdapter` takes its ioredis branch, not its node-redis v4 branch.
 *
 * The `: FakeSub` return annotation is load-bearing — it is what makes TypeScript
 * check this literal member-by-member against the real `Redis` declarations.
 */
function createFakeSub(): FakeSub {
  const sub = Object.assign(new EventEmitter(), {
    status: "connecting" as Redis["status"],
    statusAtFirstCommand: null as string | null,
    psubscribe: () => issue(),
    subscribe: () => issue(),
    quit: async () => "OK" as const,
    disconnect: () => {},
  });
  /**
   * One command, behaving as ioredis does under `enableOfflineQueue: false`:
   * resolve once the socket is writable, reject before that instead of queueing.
   * Records the status at the FIRST command, which is the assertion that
   * distinguishes an adapter built on a ready client from one built on a cold
   * one — the whole point of this suite.
   */
  function issue(): Promise<"OK"> {
    sub.statusAtFirstCommand ??= sub.status;
    return sub.status === "ready"
      ? Promise.resolve("OK" as const)
      : Promise.reject(new Error(COLD_COMMAND_ERROR));
  }
  return sub;
}

/**
 * The publisher side: already connected, and its `duplicate()` hands back the
 * cold subscriber above — the production shape, where the shared client is live
 * and only the duplicate has to catch up. The `: FakePub` return annotation is
 * what makes TypeScript check this literal against the real `Redis` members.
 */
function createFakePub(sub: FakeSub): FakePub {
  return Object.assign(new EventEmitter(), {
    status: "ready" as Redis["status"],
    // `duplicate()` copies OPTIONS, never listeners or connection state — which is
    // the whole reason the returned client is cold. Its declared return is the
    // nominal `Redis`; the double itself is structurally checked as `FakeSub`.
    duplicate: () => sub as unknown as Redis,
    quit: async () => "OK" as const,
  });
}

/** Node delivers `unhandledRejection` at the end of a turn, not synchronously. */
function settleEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe("R-RTC-1.7 — the Redis adapter's ASYNC failure must be non-fatal too (NODE-Z)", () => {
  const original = { ...process.env };
  let httpServer: HttpServer;

  beforeEach(async () => {
    process.env.COLLAB_WS_ENABLED = "true";
    httpServer = createServer();
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  });
  afterEach(() => {
    process.env = { ...original };
    httpServer.close();
  });

  it("builds the adapter only once the duplicated subscriber is ready", async () => {
    const sub = createFakeSub();
    const pub = createFakePub(sub);
    // Connects shortly after duplicate() returns — exactly like a real cold client.
    setTimeout(() => {
      sub.status = "ready";
      sub.emit("ready");
    }, 10);

    const collab = await initCollabServer(httpServer, {
      getRedisClient: async () => asRedisClient(pub),
      recordAccess: async () => true,
    });

    // The root cause: the adapter must not issue commands on a cold client.
    expect(sub.statusAtFirstCommand).toBe("ready");
    expect(collab.enabled).toBe(true);
    await collab.close();
  });

  it("never lets the subscribe rejection escape as an unhandled rejection", async () => {
    const escaped: unknown[] = [];
    const collect = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", collect);
    try {
      const sub = createFakeSub();
      const pub = createFakePub(sub);
      setTimeout(() => {
        sub.status = "ready";
        sub.emit("ready");
      }, 10);

      const collab = await initCollabServer(httpServer, {
        getRedisClient: async () => asRedisClient(pub),
        recordAccess: async () => true,
      });
      await settleEventLoop();

      // This is the exact event NODE-Z records, 270 times.
      expect(escaped).toEqual([]);
      await collab.close();
    } finally {
      process.off("unhandledRejection", collect);
    }
  });

  it("disables the channel when the subscriber never connects, instead of reporting enabled", async () => {
    const sub = createFakeSub(); // stays "connecting" forever
    const pub = createFakePub(sub);
    setTimeout(() => sub.emit("error", new Error("ECONNREFUSED")), 10);

    const collab = await initCollabServer(httpServer, {
      getRedisClient: async () => asRedisClient(pub),
      recordAccess: async () => true,
    });

    expect(collab.enabled).toBe(false);
    expect(collab.reason).toBe("REDIS_ADAPTER_FAILED");
    // …and the shared server Express + SSE + Code Blue run on is untouched.
    expect(httpServer.listening).toBe(true);
    await expect(collab.close()).resolves.toBeUndefined();
    expect(httpServer.listening).toBe(true);
  });
});
