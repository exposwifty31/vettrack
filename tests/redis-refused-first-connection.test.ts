/**
 * Boot against a Redis that refuses the first connection (the 2026-09-10 Redis
 * restarts, a cold container, a wrong port). Real ioredis, no fakes: the URL points
 * at a port nothing listens on, so every attempt is ECONNREFUSED.
 *
 * The contract for that boot path:
 *  1. neither factory throws or leaves an unhandled rejection behind;
 *  2. the refusal is reported ONCE as a warning that names the reconnect path — not
 *     as one `[redis:*] error` line per retry (200ms, 400ms, 800ms … forever);
 *  3. reconnection itself still goes through the existing retryStrategy, visible as
 *     `[redis-metric] { event: 'reconnect_scheduled' }`.
 *
 * The historical unhandled rejection at boot ("Stream isn't writeable and
 * enableOfflineQueue options is false", 2026-08-22) came from the collab Redis
 * adapter and is pinned by tests/collab-redis-adapter-async-nonfatal.test.ts; this
 * suite pins the client factories underneath it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Redis } from "ioredis";

const REFUSED_URL = "redis://127.0.0.1:1";
const READY_WAIT_MS = 5000; // createRedisConnection / getRedis wait this long for `ready`

const envBackup: Record<string, string | undefined> = {};
const ENV_KEYS = ["REDIS_URL", "REDIS_CONNECT_TIMEOUT_MS"] as const;

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

let clients: Redis[] = [];

function lines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call) => call.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}

beforeEach(() => {
  vi.resetModules();
  for (const key of ENV_KEYS) envBackup[key] = process.env[key];
  process.env.REDIS_URL = REFUSED_URL;
  process.env.REDIS_CONNECT_TIMEOUT_MS = "500";
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  for (const client of clients) client.disconnect();
  clients = [];
  for (const key of ENV_KEYS) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
  vi.restoreAllMocks();
});

describe("Redis refuses the first connection at boot", () => {
  it("createRedisConnection: resolves, warns once, reconnects via retryStrategy, no unhandled rejection", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { createRedisConnection } = await import("../server/lib/redis.js");
    const conn = await createRedisConnection();
    if (conn) clients.push(conn);

    // Give the retry loop a few more attempts after the factory returned.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(unhandled).toEqual([]);

    const refusedWarnings = lines(warnSpy).filter((line) => line.includes("first connection refused"));
    expect(refusedWarnings).toHaveLength(1);
    expect(refusedWarnings[0]).toContain("[redis:queue]");
    expect(refusedWarnings[0]).toContain("ECONNREFUSED");
    // The payload carries the same queryable fields as the metric event, not just the message.
    expect(refusedWarnings[0]).toContain('"source":"queue"');
    expect(refusedWarnings[0]).toContain('"phase":"initial_connect"');

    // The per-retry error line is what the single warning replaces.
    const perRetryErrors = lines(errorSpy).filter((line) => line.includes("[redis:queue] error"));
    expect(perRetryErrors).toEqual([]);

    const reconnects = lines(logSpy).filter(
      (line) => line.includes("[redis-metric]") && line.includes("reconnect_scheduled"),
    );
    expect(reconnects.length).toBeGreaterThanOrEqual(2);
  }, READY_WAIT_MS + 5000);

  it("getRedis: same contract for the shared app client", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { getRedis } = await import("../server/lib/redis.js");
    const client = await getRedis();
    if (client) clients.push(client);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(unhandled).toEqual([]);
    expect(lines(warnSpy).filter((line) => line.includes("[redis:app] first connection refused"))).toHaveLength(1);
    expect(lines(errorSpy).filter((line) => line.includes("[redis:app] error"))).toEqual([]);
  }, READY_WAIT_MS + 5000);

  it("a refused connection AFTER the client was ready is still reported on the error line (not swallowed)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { createRedisConnection } = await import("../server/lib/redis.js");
    const conn = await createRedisConnection();
    if (!conn) {
      throw new Error("createRedisConnection() returned null: REDIS_URL was set, so a client (even a reconnecting one) was expected");
    }
    clients.push(conn);

    // Simulate a client that had connected, then lost Redis entirely: ioredis emits `ready`
    // then a refused reconnect. A refusal AFTER ready is the regression the guard must not
    // swallow — so this emits the exact error class the guard special-cases.
    conn.emit("ready");
    conn.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));

    const postReady = lines(errorSpy).filter((line) => line.includes("[redis:queue] error") && line.includes("ECONNREFUSED"));
    expect(postReady).toHaveLength(1);
  }, READY_WAIT_MS + 5000);
});
