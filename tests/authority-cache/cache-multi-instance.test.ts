/**
 * Phase 2.5 PR 6 — Multi-instance stale-window simulation (test #14).
 *
 * The cache is process-local. A write in pod A does NOT invalidate caches
 * in pod B. Cross-pod consistency relies entirely on TTL healing.
 *
 * This test simulates two pods with independent caches sharing a single
 * mocked DB. After pod A invalidates, pod B still serves stale data until
 * its own TTL expires.
 *
 * This is an INTENTIONAL architectural property — future enforcement work
 * cannot assume strong distributed consistency from this layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "../../server/lib/analytics-cache.js";

interface SimpleRow {
  id: string;
  value: string;
}

// A tiny harness that simulates a per-pod cache wrapper over a shared
// "database". We can't easily double-instantiate the real module-level
// cache, so this test exercises the *property* using TtlCache directly.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-14T08:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("multi-instance stale window (test #14)", () => {
  it("write invalidates pod A but pod B serves stale until TTL", async () => {
    const sharedDb = { value: "v1" };
    const podACache = new TtlCache<SimpleRow>({ ttlMs: 30_000 });
    const podBCache = new TtlCache<SimpleRow>({ ttlMs: 30_000 });

    const fetchFromDb = (): SimpleRow => ({
      id: "row-1",
      value: sharedDb.value,
    });

    // Both pods prime their caches.
    const aBefore = podACache.get("row-1") ?? fetchFromDb();
    podACache.set("row-1", aBefore);
    const bBefore = podBCache.get("row-1") ?? fetchFromDb();
    podBCache.set("row-1", bBefore);
    expect(aBefore.value).toBe("v1");
    expect(bBefore.value).toBe("v1");

    // Pod A "writes" the DB and invalidates its OWN cache.
    sharedDb.value = "v2";
    podACache.invalidate("row-1");

    // Pod A's next read sees the new value.
    const aAfter = podACache.get("row-1") ?? fetchFromDb();
    podACache.set("row-1", aAfter);
    expect(aAfter.value).toBe("v2");

    // Pod B is still serving stale — this is the intentional behavior.
    expect(podBCache.get("row-1")?.value).toBe("v1");

    // After TTL elapses, pod B re-reads.
    vi.advanceTimersByTime(30_001);
    const bHealed = podBCache.get("row-1") ?? fetchFromDb();
    expect(bHealed.value).toBe("v2");
  });
});
