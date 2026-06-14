/**
 * Shared Redis connection for cache + BullMQ (lazy init, safe fallback when unset).
 *
 * Redis failure policy (must remain consistent across call sites):
 * - cache: fail-open (return uncached response)
 * - rate-limit: fail-open (allow request, but emit observability signals)
 * - idempotency: fail-closed (treat as already-processed)
 *
 * Architecture note:
 * - Today cache + BullMQ share the same Redis deployment/connection strategy.
 * - At higher scale, split queue and cache workloads to reduce contention.
 */
import { Redis, type RedisOptions } from "ioredis";
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker.js";

let shared: Redis | null = null;
let creationFailed = false;
let redisDisabledWarned = false;
let sharedReadyResolve: (() => void) | null = null;

const DEFAULT_CACHE_TTL_SEC = 300;
const DEFAULT_SCAN_MAX_KEYS = 2000;
const SLOW_REDIS_OP_MS = 100;
const LOCK_WAIT_MS = 50;
const LOCK_MAX_RETRIES = 8;
const LOCK_TTL_SEC = 5;
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 5000);
const COMMAND_TIMEOUT_MS = Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 4000);
const MAX_RETRIES_PER_REQUEST = Number(process.env.REDIS_MAX_RETRIES_PER_REQUEST ?? 1);
const RETRY_DELAY_CAP_MS = 5000;
const ALLOWED_REDIS_COMMANDS = new Set(["GET", "SET", "DEL", "INCR", "EXPIRE", "SCAN"]);
const RATE_LIMIT_LUA = `
local current = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
return current
`;
const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export function getRedisUrl(): string | null {
  const u = process.env.REDIS_URL?.trim();
  return u || null;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeSegment(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[:_ -]+|[:_ -]+$/g, "");
  return normalized || "unknown";
}

function isSafeAppKey(key: string): boolean {
  return /^vettrack:[a-z0-9:_-]+:[a-z0-9:_-]+$/.test(key);
}

function lockKeyFor(cacheKey: string): string {
  return `${cacheKey}:__lock`;
}

function createLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function redisMetric(event: string, tags: Record<string, string | number | boolean> = {}): void {
  console.log("[redis-metric]", { event, ...tags });
}

export function recordRedisFallback(operation: string): void {
  redisMetric("fallback", { operation });
  console.warn("[redis] fallback", { operation });
}

export async function timedRedisOp<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await fn();
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_REDIS_OP_MS) {
      redisMetric("slow_op", { operation, durationMs });
      console.warn("[redis] slow operation", { operation, durationMs });
    }
    return value;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    redisMetric("error", { operation, durationMs });
    console.error("[redis] operation failed", {
      operation,
      durationMs,
      message: (err as Error).message,
    });
    throw err;
  }
}

function buildRetryDelay(times: number): number {
  const expDelay = Math.min(200 * (2 ** Math.max(times - 1, 0)), RETRY_DELAY_CAP_MS);
  return expDelay;
}

function shouldReconnectOnError(err: Error): boolean {
  const message = err.message.toUpperCase();
  return message.includes("READONLY") || message.includes("ECONNRESET") || message.includes("ETIMEDOUT");
}

function redisOptions(): RedisOptions {
  return {
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
    enableReadyCheck: true,
    lazyConnect: false,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      const delay = buildRetryDelay(times);
      if (times <= 3 || times % 20 === 0) {
        redisMetric("reconnect_scheduled", { attempt: times, delayMs: delay });
        console.warn("[redis] reconnect scheduled", { attempt: times, delayMs: delay });
      }
      return delay;
    },
    reconnectOnError(err: Error) {
      return shouldReconnectOnError(err);
    },
  };
}

/**
 * BullMQ uses blocking commands (e.g. BLPOP) that can wait longer than normal cache ops.
 * ioredis `commandTimeout` applies to every command including blocking ones — if set, workers
 * throw `Error: Command timed out` on each block longer than the cap (default 4000ms).
 * Omit per-command timeout here; keep `connectTimeout` / retry behavior from `redisOptions()`.
 */
function redisQueueOptions(): RedisOptions {
  const { commandTimeout: _omitCommandTimeout, ...rest } = redisOptions();
  return {
    ...rest,
    maxRetriesPerRequest: null,
  };
}

function attachRedisObservers(client: Redis, source: "app" | "queue"): void {
  client.on("connect", () => {
    redisMetric("connect", { source });
    console.log(`[redis:${source}] connecting`);
  });
  client.on("ready", () => {
    redisMetric("ready", { source });
    console.log(`[redis:${source}] ready`);
    if (source === "app") sharedReadyResolve?.();
  });
  client.on("error", (err) => {
    recordFailure("redis");
    redisMetric("error", { source, phase: "event" });
    console.error(`[redis:${source}] error`, { message: err.message });
  });
  client.on("close", () => {
    redisMetric("close", { source });
    console.warn(`[redis:${source}] connection closed`);
  });
  client.on("reconnecting", (delay: number) => {
    redisMetric("reconnecting", { source, delayMs: delay });
    console.warn(`[redis:${source}] reconnecting`, { delayMs: delay });
  });
}

/**
 * Singleton IORedis client for general use (cache, rate limits).
 * Returns null if REDIS_URL is missing or client creation failed — never throws to callers.
 * Waits up to 5 seconds for the client to be ready before returning (fail-open on timeout).
 */
export async function getRedis(): Promise<Redis | null> {
  if (isCircuitOpen("redis")) return null;
  if (creationFailed) return null;
  if (shared) {
    if (shared.status === "ready") return shared;
    await Promise.race([
      new Promise<void>((resolve) => { sharedReadyResolve = resolve; }),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]).finally(() => { sharedReadyResolve = null; });
    return shared;
  }
  const url = getRedisUrl();
  if (!url) {
    if (!redisDisabledWarned) {
      redisDisabledWarned = true;
      console.warn("REDIS_DISABLED: running without Redis");
    }
    return null;
  }
  try {
    shared = new Redis(url, redisOptions());
    attachRedisObservers(shared, "app");
  } catch (err) {
    recordFailure("redis");
    creationFailed = true;
    console.error("[redis] failed to create client:", err);
    return null;
  }
  recordSuccess("redis");
  if (shared.status !== "ready") {
    await Promise.race([
      new Promise<void>((resolve) => { sharedReadyResolve = resolve; }),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]).finally(() => { sharedReadyResolve = null; });
    if ((shared.status as string) !== "ready") {
      console.warn("[redis] client not ready after 5s timeout; proceeding anyway");
    }
  }
  return shared;
}

/**
 * Factory that creates a fresh dedicated ioredis connection for each BullMQ entity
 * (Queue, Worker, QueueScheduler, etc.).
 *
 * BullMQ requires every Worker to own its connection exclusively because Workers
 * use blocking commands (BLPOP/BRPOP) that monopolise the connection. Sharing a
 * single connection across multiple BullMQ entities causes the
 * "maxRetriesPerRequest must be null" error and prevents workers from starting.
 *
 * maxRetriesPerRequest is set to null (via redisQueueOptions) as required by BullMQ.
 * Waits up to 5 seconds for the connection to become ready before returning.
 */
export async function createRedisConnection(): Promise<Redis | null> {
  if (isCircuitOpen("redis")) return null;
  const url = getRedisUrl();
  if (!url) return null;
  let conn: Redis;
  try {
    conn = new Redis(url, redisQueueOptions());
    attachRedisObservers(conn, "queue");
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] BullMQ connection failed:", err);
    return null;
  }
  if (conn.status !== "ready") {
    await Promise.race([
      new Promise<void>((resolve) => { conn.once("ready", resolve); }),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    if ((conn.status as string) !== "ready") {
      console.warn("[redis] BullMQ connection not ready after 5s timeout; proceeding anyway");
    }
  }
  return conn;
}


export function redisKey(service: string, domain: string, id: string): string {
  const safeService = sanitizeSegment(service);
  const safeDomain = sanitizeSegment(domain);
  const safeId = sanitizeSegment(id);
  return `${safeService}:${safeDomain}:${safeId}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("cacheGet");
    return null;
  }
  try {
    const raw = await timedRedisOp("cacheGet", () => r.get(key));
    if (raw == null) return null;
    const value = JSON.parse(raw) as T;
    recordSuccess("redis");
    return value;
  } catch (err) {
    recordFailure("redis");
    console.warn("[redis] cacheGet failed", { key, message: (err as Error).message });
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec: number = DEFAULT_CACHE_TTL_SEC): Promise<boolean> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("cacheSet");
    return false;
  }
  try {
    const effectiveTtl = Math.max(1, Math.floor(ttlSec || DEFAULT_CACHE_TTL_SEC));
    const payload = JSON.stringify(value);
    await timedRedisOp("cacheSet", () => r.set(key, payload, "EX", effectiveTtl));
    recordSuccess("redis");
    return true;
  } catch (err) {
    recordFailure("redis");
    console.warn("[redis] cacheSet failed", { key, message: (err as Error).message });
    return false;
  }
}

export async function cacheDel(key: string): Promise<void> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("cacheDel");
    return;
  }
  try {
    await timedRedisOp("cacheDel", () => r.del(key));
    recordSuccess("redis");
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] DEL failed:", (err as Error).message);
  }
}

function assertSafeRedisCommand(command: string): void {
  const upper = command.trim().toUpperCase();
  if (!ALLOWED_REDIS_COMMANDS.has(upper)) {
    throw new Error(`Redis command not allowed: ${upper}`);
  }
}

function assertSafeRedisCommandArgs(command: string, args: (string | number)[]): void {
  const upper = command.trim().toUpperCase();
  if (upper === "SCAN") return;
  const keyArg = String(args[0] ?? "");
  if (!isSafeAppKey(keyArg)) {
    throw new Error("Redis key rejected: must match vettrack:<domain>:<id>");
  }
  if (upper === "SET") {
    if (args.length < 4) {
      throw new Error("Redis SET requires key, value and TTL flag");
    }
    const flags = args.slice(2).map((a) => String(a).toUpperCase());
    const hasTtl = flags.includes("EX") || flags.includes("PX");
    if (!hasTtl) {
      throw new Error("Redis SET requires EX or PX TTL");
    }
  }
}

async function runRedisCommand(command: string, ...args: (string | number)[]): Promise<unknown> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("runRedisCommand");
    return null;
  }
  assertSafeRedisCommand(command);
  assertSafeRedisCommandArgs(command, args);
  try {
    return await timedRedisOp(`runRedisCommand:${command.toUpperCase()}`, () =>
      r.call(command, ...args.map((a) => String(a))),
    );
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] command failed", { command, message: (err as Error).message });
    return null;
  }
}

async function scanKeys(matchPattern: string, count = 100): Promise<string[]> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("scanKeys");
    return [];
  }
  const out: string[] = [];
  let cursor = "0";
  const safeCount = Math.max(10, Math.min(1000, Math.floor(count)));
  try {
    do {
      const [nextCursor, keys] = await timedRedisOp("scanKeys", () =>
        r.scan(cursor, "MATCH", matchPattern, "COUNT", safeCount),
      );
      cursor = nextCursor;
      out.push(...keys);
      if (out.length >= DEFAULT_SCAN_MAX_KEYS) {
        console.warn("[redis] scanKeys max limit reached", {
          matchPattern,
          maxKeys: DEFAULT_SCAN_MAX_KEYS,
        });
        return out.slice(0, DEFAULT_SCAN_MAX_KEYS);
      }
    } while (cursor !== "0");
    return out;
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] SCAN failed", { matchPattern, message: (err as Error).message });
    return out;
  }
}

// Backwards-compatible wrappers while call sites are migrated.
export async function safeRedisGet(key: string): Promise<string | null> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("safeRedisGet");
    return null;
  }
  try {
    const value = await timedRedisOp("safeRedisGet", () => r.get(key));
    recordSuccess("redis");
    return value;
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] GET failed:", (err as Error).message);
    return null;
  }
}

export async function safeRedisSetex(key: string, ttlSec: number, value: string): Promise<boolean> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("safeRedisSetex");
    return false;
  }
  try {
    const effectiveTtl = Math.max(1, Math.floor(ttlSec || DEFAULT_CACHE_TTL_SEC));
    await timedRedisOp("safeRedisSetex", () => r.set(key, value, "EX", effectiveTtl));
    recordSuccess("redis");
    return true;
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] SETEX failed:", (err as Error).message);
    return false;
  }
}

async function safeRedisDel(key: string): Promise<void> {
  return cacheDel(key);
}

/** Returns true if increment allowed, false if rate limited. */
export async function incrementRateLimit(
  key: string,
  ttlSec: number,
  max: number,
): Promise<boolean> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("incrementRateLimit");
    return true;
  }
  try {
    const safeTtlSec = Math.max(1, Math.floor(ttlSec));
    const n = Number(
      await timedRedisOp("incrementRateLimit", () => r.eval(RATE_LIMIT_LUA, 1, key, String(safeTtlSec))),
    );
    if (!Number.isFinite(n)) throw new Error("rate limit script returned non-number");
    recordSuccess("redis");
    return n <= max;
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] rate limit INCR failed:", (err as Error).message);
    return true;
  }
}

async function cacheGetOrSet<T>(
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached != null) return cached;

  const r = await getRedis();
  if (!r) {
    recordRedisFallback("cacheGetOrSet");
    return await fetcher();
  }

  const effectiveTtl = Math.max(1, Math.floor(ttlSec || DEFAULT_CACHE_TTL_SEC));
  const lockKey = lockKeyFor(key);
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    const token = createLockToken();
    const lockAcquired = await timedRedisOp("cacheGetOrSet:acquireLock", async () => {
      const result = await r.set(lockKey, token, "EX", LOCK_TTL_SEC, "NX");
      return result === "OK";
    });
    if (lockAcquired) {
      try {
        const fresh = await fetcher();
        await cacheSet(key, fresh, effectiveTtl);
        return fresh;
      } finally {
        try {
          await timedRedisOp("cacheGetOrSet:releaseLock", () =>
            r.eval(RELEASE_LOCK_LUA, 1, lockKey, token),
          );
        } catch {
          // Lock has short TTL; release is best-effort.
        }
      }
    }
    redisMetric("lock_contention", { key, attempt: attempt + 1, phase: "acquire_failed" });
    await sleepMs(LOCK_WAIT_MS);
    const retryCached = await cacheGet<T>(key);
    if (retryCached != null) return retryCached;
  }

  redisMetric("lock_contention", { key, phase: "wait_exceeded" });
  console.warn("[redis] cache lock wait exceeded; proceeding without lock", { key });
  const value = await fetcher();
  await cacheSet(key, value, effectiveTtl);
  return value;
}

async function redisHealthCheck(): Promise<boolean> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("redisHealthCheck");
    return false;
  }
  try {
    const pong = await timedRedisOp("redisHealthCheck", async () => {
      return await Promise.race([
        r.ping(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("redis health check timed out")), 1000),
        ),
      ]);
    });
    recordSuccess("redis");
    return pong === "PONG";
  } catch (err) {
    recordFailure("redis");
    console.error("[redis] health check failed", { message: (err as Error).message });
    return false;
  }
}
