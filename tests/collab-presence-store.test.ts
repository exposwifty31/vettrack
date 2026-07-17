/**
 * R-RTC-1.5 — ephemeral presence store: TTL expiry, bounded growth, and the
 * reference-counted multi-socket lease rule (a user stays present until ALL their
 * leases in a room expire/disconnect).
 */
import { describe, it, expect } from "vitest";
import type { Redis } from "ioredis";
import { createPresenceStore } from "../server/lib/realtime-collab/presence-store.js";
import {
  COLLAB_REDIS_PREFIX,
  PRESENCE_KEY_EXPIRE_MARGIN_MS,
} from "../server/lib/realtime-collab/config.js";

const presenceKeyFor = (room: string): string => `${COLLAB_REDIS_PREFIX}presence:${room}`;

/**
 * Minimal in-memory Redis double supporting ONLY the ZSET surface the presence
 * store now uses (zadd / zrem / zremrangebyscore / zrange / pexpire) — shared
 * between two stores to simulate the 2-instance topology the collab channel
 * REQUIRES Redis for. Scores are per-member lease-expiry timestamps, so TTL prune
 * is observable via ZREMRANGEBYSCORE. A `scan` stub records any call so tests can
 * PROVE the converged read never falls back to a whole-keyspace SCAN (card #4).
 *
 * The double also HONORS key-level TTL set via PEXPIRE against an injectable clock,
 * so tests can PROVE an ABANDONED room's ZSET key self-expires off Redis even when
 * it is never read again (re-attempt HIGH: abandoned-key keyspace leak). Callers
 * that don't need key-TTL semantics pass no clock (real wall-clock never advances
 * far enough within a test to trip an expiry).
 */
function makeFakeRedis(clock: () => number = () => Date.now()) {
  // key -> Map<member, score>  (score = lease expiry timestamp)
  const z = new Map<string, Map<string, number>>();
  // key -> absolute ms at which Redis auto-deletes the whole key (PEXPIRE).
  const keyExpiryAt = new Map<string, number>();
  function purgeExpiredKeys(): void {
    const t = clock();
    for (const [k, exp] of keyExpiryAt) {
      if (exp <= t) {
        z.delete(k);
        keyExpiryAt.delete(k);
      }
    }
  }
  const api = {
    scanCalls: 0,
    pexpireCalls: 0,
    /** Test helper: does the key currently exist (after honoring key TTL)? */
    hasKey(key: string): boolean {
      purgeExpiredKeys();
      return z.has(key);
    },
    async zadd(key: string, score: number | string, member: string): Promise<number> {
      purgeExpiredKeys();
      let s = z.get(key);
      if (!s) {
        s = new Map();
        z.set(key, s);
      }
      const existed = s.has(member);
      s.set(member, Number(score));
      return existed ? 0 : 1;
    },
    async pexpire(key: string, ms: number | string): Promise<number> {
      api.pexpireCalls += 1;
      if (!z.has(key)) return 0;
      keyExpiryAt.set(key, clock() + Number(ms));
      return 1;
    },
    async zrem(key: string, ...members: string[]): Promise<number> {
      purgeExpiredKeys();
      const s = z.get(key);
      if (!s) return 0;
      let n = 0;
      for (const m of members) if (s.delete(m)) n += 1;
      if (s.size === 0) {
        z.delete(key);
        keyExpiryAt.delete(key);
      }
      return n;
    },
    async zremrangebyscore(key: string, min: string | number, max: string | number): Promise<number> {
      purgeExpiredKeys();
      const s = z.get(key);
      if (!s) return 0;
      const lo = min === "-inf" ? -Infinity : Number(min);
      const hi = max === "+inf" ? Infinity : Number(max);
      let n = 0;
      for (const [m, score] of [...s]) {
        if (score >= lo && score <= hi) {
          s.delete(m);
          n += 1;
        }
      }
      if (s.size === 0) {
        z.delete(key);
        keyExpiryAt.delete(key);
      }
      return n;
    },
    async zrange(key: string, start: number, stop: number): Promise<string[]> {
      purgeExpiredKeys();
      const s = z.get(key);
      if (!s) return [];
      const sorted = [...s.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
      return sorted.slice(start, end);
    },
    async scan(): Promise<[string, string[]]> {
      api.scanCalls += 1;
      return ["0", []];
    },
  };
  return api;
}

const asRedisFactory = (r: ReturnType<typeof makeFakeRedis> | null) => async (): Promise<Redis | null> =>
  r as unknown as Redis | null;

describe("presence store — R-RTC-1.5", () => {
  it("expires a presence entry after its TTL", () => {
    let t = 1_000;
    const store = createPresenceStore({ now: () => t, ttlMs: 5_000 });
    store.addLease("room", { userId: "u1", displayName: "U1" }, "s1");
    expect(store.getPresent("room")).toEqual([{ userId: "u1", displayName: "U1" }]);
    t += 5_001; // past TTL
    expect(store.getPresent("room")).toEqual([]);
  });

  it("keeps a user present until ALL their sockets disconnect (reference-counted)", () => {
    let t = 0;
    const store = createPresenceStore({ now: () => t, ttlMs: 10_000 });
    // Same user, two sockets (e.g. two browser tabs).
    const newlyPresentA = store.addLease("room", { userId: "u1", displayName: "U1" }, "sA");
    const newlyPresentB = store.addLease("room", { userId: "u1", displayName: "U1" }, "sB");
    expect(newlyPresentA).toBe(true); // first lease made them present
    expect(newlyPresentB).toBe(false); // second lease did not
    expect(store.getPresent("room")).toHaveLength(1);

    // One socket disconnects — user is NOT removed (other lease remains).
    const goneAfterA = store.removeLease("room", "sA");
    expect(goneAfterA).toBe(false);
    expect(store.getPresent("room")).toEqual([{ userId: "u1", displayName: "U1" }]);

    // Last socket disconnects — now fully absent.
    const goneAfterB = store.removeLease("room", "sB");
    expect(goneAfterB).toBe(true);
    expect(store.getPresent("room")).toEqual([]);
  });

  it("refreshes TTL on touch (heartbeat)", () => {
    let t = 0;
    const store = createPresenceStore({ now: () => t, ttlMs: 10_000 });
    store.addLease("room", { userId: "u1", displayName: "U1" }, "s1");
    t = 8_000;
    store.touch("room", "s1"); // extend to 18_000
    t = 12_000;
    expect(store.getPresent("room")).toHaveLength(1); // would have expired without touch
  });

  it("bounds in-process growth (excess leases dropped, no unbounded map)", () => {
    const store = createPresenceStore({ ttlMs: 60_000 });
    // Far exceed the per-room cap; store must not grow without bound.
    for (let i = 0; i < 2_000; i++) {
      store.addLease("room", { userId: `u${i}`, displayName: `U${i}` }, `s${i}`);
    }
    expect(store.size()).toBeLessThanOrEqual(500); // FALLBACK_MAP_MAX_LEASES_PER_ROOM
  });

  it("dedupes the presence list by userId across leases", () => {
    const store = createPresenceStore({ ttlMs: 60_000 });
    store.addLease("room", { userId: "u1", displayName: "U1" }, "s1");
    store.addLease("room", { userId: "u1", displayName: "U1" }, "s2");
    store.addLease("room", { userId: "u2", displayName: "U2" }, "s3");
    const present = store.getPresent("room").map((m) => m.userId).sort();
    expect(present).toEqual(["u1", "u2"]);
  });
});

describe("presence store — cross-instance convergence (R-RTC-1.5 / card H5)", () => {
  it("a peer registered on ANOTHER instance appears in the converged view (Redis-mirrored)", async () => {
    const redis = makeFakeRedis();
    const factory = asRedisFactory(redis);
    const room = "clinic:A:chat";
    const inst1 = createPresenceStore({ getRedisClient: factory });
    const inst2 = createPresenceStore({ getRedisClient: factory });

    await inst1.register(room, { userId: "u1", displayName: "U1" }, "s1");
    // inst2 holds NO local lease for u1 — its LOCAL view is empty…
    expect(inst2.getPresent(room)).toEqual([]);
    // …but the converged read sees u1 via the shared Redis lease keyspace.
    expect(await inst2.getConvergedPresent(room)).toEqual([{ userId: "u1", displayName: "U1" }]);
  });

  it("reads are room-scoped via a ZSET — never SCANs the shared keyspace (card #4)", async () => {
    const redis = makeFakeRedis();
    const factory = asRedisFactory(redis);
    const inst1 = createPresenceStore({ getRedisClient: factory });
    const inst2 = createPresenceStore({ getRedisClient: factory });
    await inst1.register("clinic:A:chat", { userId: "u1", displayName: "U1" }, "s1");
    // Unrelated presence rooms must not affect the read's cost or its result — the
    // converged read touches ONLY the room's ZSET key, not the whole keyspace.
    await inst1.register("clinic:Z:board", { userId: "u9", displayName: "U9" }, "s9");
    expect(await inst2.getConvergedPresent("clinic:A:chat")).toEqual([
      { userId: "u1", displayName: "U1" },
    ]);
    // The old implementation did SCAN + MGET over the shared keyspace on EVERY read;
    // the ZSET path must never scan (cost is O(room members), not O(keyspace)).
    expect(redis.scanCalls).toBe(0);
  });

  it("prunes expired ZSET leases on the converged read (TTL via ZREMRANGEBYSCORE)", async () => {
    const redis = makeFakeRedis();
    let t = 1_000;
    const store = createPresenceStore({
      getRedisClient: asRedisFactory(redis),
      now: () => t,
      ttlMs: 5_000,
    });
    const room = "clinic:A:chat";
    await store.register(room, { userId: "u1", displayName: "U1" }, "s1");
    expect(await store.getConvergedPresent(room)).toEqual([{ userId: "u1", displayName: "U1" }]);
    t += 5_001; // past TTL — the lease's ZSET score is now in the prune range
    expect(await store.getConvergedPresent(room)).toEqual([]);
  });

  it("does NOT leak presence across clinics (converged read is scoped to the room's clinic)", async () => {
    const redis = makeFakeRedis();
    const factory = asRedisFactory(redis);
    const inst1 = createPresenceStore({ getRedisClient: factory });
    const inst2 = createPresenceStore({ getRedisClient: factory });
    await inst1.register("clinic:A:chat", { userId: "u1", displayName: "U1" }, "s1");
    // A different clinic's room must never surface clinic-A's member.
    expect(await inst2.getConvergedPresent("clinic:B:chat")).toEqual([]);
  });

  it("stays present across instances until ALL leases drop (ref-counted across the fleet)", async () => {
    const redis = makeFakeRedis();
    const factory = asRedisFactory(redis);
    const room = "clinic:A:chat";
    const inst1 = createPresenceStore({ getRedisClient: factory });
    const inst2 = createPresenceStore({ getRedisClient: factory });
    // Same user, one socket on each instance.
    await inst1.register(room, { userId: "u1", displayName: "U1" }, "s1");
    await inst2.register(room, { userId: "u1", displayName: "U1" }, "s2");
    expect(await inst2.getConvergedPresent(room)).toEqual([{ userId: "u1", displayName: "U1" }]);
    // The socket on inst1 disconnects — u1 still present (inst2 lease remains).
    await inst1.unregister(room, "s1");
    expect(await inst2.getConvergedPresent(room)).toEqual([{ userId: "u1", displayName: "U1" }]);
    // Last socket drops — now fully absent everywhere.
    await inst2.unregister(room, "s2");
    expect(await inst2.getConvergedPresent(room)).toEqual([]);
  });

  it("falls back to the local view when Redis is unavailable (never throws)", async () => {
    const room = "clinic:A:chat";
    const store = createPresenceStore({ getRedisClient: asRedisFactory(null) });
    await store.register(room, { userId: "u1", displayName: "U1" }, "s1");
    expect(await store.getConvergedPresent(room)).toEqual([{ userId: "u1", displayName: "U1" }]);
  });
});

describe("presence store — abandoned-room key self-expiry (re-attempt HIGH: keyspace leak)", () => {
  it("sets a key-level TTL (PEXPIRE) alongside each ZADD so abandoned rooms self-clean", async () => {
    let t = 1_000;
    const redis = makeFakeRedis(() => t);
    const store = createPresenceStore({
      getRedisClient: asRedisFactory(redis),
      now: () => t,
      ttlMs: 5_000,
    });
    const room = "clinic:A:chat";
    await store.register(room, { userId: "u1", displayName: "U1" }, "s1");
    // register → writeLease must issue a PEXPIRE, not just a ZADD.
    expect(redis.pexpireCalls).toBeGreaterThan(0);
  });

  it("an abandoned room's ZSET key self-expires off Redis even when it is NEVER re-read", async () => {
    let t = 1_000;
    const redis = makeFakeRedis(() => t);
    const ttlMs = 5_000;
    const store = createPresenceStore({
      getRedisClient: asRedisFactory(redis),
      now: () => t,
      ttlMs,
    });
    const room = "clinic:R:eq-42"; // record-presence rooms are keyed per-equipment and can be many
    await store.register(room, { userId: "u1", displayName: "U1" }, "s1");
    expect(redis.hasKey(presenceKeyFor(room))).toBe(true);

    // Instance crashes: no unregister ever fires, and this room is never read again.
    // Advance past the lease TTL AND the key-expiry margin.
    t += ttlMs + PRESENCE_KEY_EXPIRE_MARGIN_MS + 1;

    // Without a read-time prune, only the key-level PEXPIRE can reclaim it. The stale
    // ZSET key must NOT linger on the shared Redis forever (the leak this card closes).
    expect(redis.hasKey(presenceKeyFor(room))).toBe(false);
  });

  it("a live heartbeat (refresh) re-arms the key TTL so an active room never self-expires early", async () => {
    let t = 1_000;
    const redis = makeFakeRedis(() => t);
    const ttlMs = 5_000;
    const store = createPresenceStore({
      getRedisClient: asRedisFactory(redis),
      now: () => t,
      ttlMs,
    });
    const room = "clinic:A:chat";
    await store.register(room, { userId: "u1", displayName: "U1" }, "s1");

    // Heartbeat just before the key would have expired — must re-issue PEXPIRE.
    t += ttlMs; // 6_000: within key life (key expires at 1_000 + 15_000)
    await store.refresh(room, "s1");

    // Advance to just past the ORIGINAL key expiry; the refresh should have pushed it out.
    t = 1_000 + ttlMs + PRESENCE_KEY_EXPIRE_MARGIN_MS + 1; // 16_001
    expect(redis.hasKey(presenceKeyFor(room))).toBe(true);
    // The member is still live (refreshed to expire at 6_000 + 5_000 = 11_000 < 16_001?)…
    // it has since expired by score, so the converged read prunes it and returns [].
    expect(await store.getConvergedPresent(room)).toEqual([]);
  });
});
