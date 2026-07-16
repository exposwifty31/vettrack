/**
 * R-RTC-1.5 — ephemeral presence store: TTL expiry, bounded growth, and the
 * reference-counted multi-socket lease rule (a user stays present until ALL their
 * leases in a room expire/disconnect).
 */
import { describe, it, expect } from "vitest";
import type { Redis } from "ioredis";
import { createPresenceStore } from "../server/lib/realtime-collab/presence-store.js";

/**
 * Minimal in-memory Redis double supporting only the presence-store surface
 * (set/PX, del, scan/MATCH, mget) — shared between two stores to simulate the
 * 2-instance topology the collab channel REQUIRES Redis for. Honors PX TTL so
 * expiry semantics stay observable.
 */
function makeFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const alive = (k: string, now: number): boolean => {
    const e = store.get(k);
    if (!e) return false;
    if (e.expiresAt <= now) {
      store.delete(k);
      return false;
    }
    return true;
  };
  return {
    async set(key: string, value: string, _mode: "PX", ttlMs: number): Promise<"OK"> {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return "OK";
    },
    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n += 1;
      return n;
    },
    async scan(
      _cursor: string,
      _match: "MATCH",
      pattern: string,
      _count: "COUNT",
      _n: number,
    ): Promise<[string, string[]]> {
      const now = Date.now();
      const re = new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      const keys: string[] = [];
      for (const k of [...store.keys()]) if (alive(k, now) && re.test(k)) keys.push(k);
      return ["0", keys];
    },
    async mget(...keys: string[]): Promise<(string | null)[]> {
      const now = Date.now();
      return keys.map((k) => (alive(k, now) ? store.get(k)!.value : null));
    },
  };
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
