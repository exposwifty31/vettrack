/**
 * R-RTC-1.5 — ephemeral presence store: TTL expiry, bounded growth, and the
 * reference-counted multi-socket lease rule (a user stays present until ALL their
 * leases in a room expire/disconnect).
 */
import { describe, it, expect } from "vitest";
import { createPresenceStore } from "../server/lib/realtime-collab/presence-store.js";

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
