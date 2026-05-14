/**
 * Phase 2.5 PR 6 — TtlCache primitive tests.
 *
 * Covers the additive extensions added in this PR: optional ttlMs,
 * maxEntries soft-cap eviction, per-key generation epochs, and
 * invalidatePrefix. Existing `analyticsCache` behavior is exercised by other
 * tests; this file isolates the new surfaces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "../../server/lib/analytics-cache.js";

describe("TtlCache extensions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("default constructor preserves backward-compatible behavior", () => {
    const cache = new TtlCache<string>();
    cache.set("a", "value-a");
    expect(cache.get("a")).toBe("value-a");
    cache.invalidate("a");
    expect(cache.get("a")).toBeNull();
  });

  it("respects ttlMs override", () => {
    const cache = new TtlCache<string>({ ttlMs: 5_000 });
    cache.set("k", "v");
    vi.advanceTimersByTime(4_999);
    expect(cache.get("k")).toBe("v");
    vi.advanceTimersByTime(2);
    expect(cache.get("k")).toBeNull();
  });

  describe("soft-cap eviction (test #16)", () => {
    it("evicts the entry with the lowest expiresAt when at capacity", () => {
      const evicted: string[] = [];
      const cache = new TtlCache<string>({
        ttlMs: 10_000,
        maxEntries: 3,
        onEvict: (k) => evicted.push(k),
      });
      cache.set("oldest", "v");
      vi.advanceTimersByTime(1);
      cache.set("middle", "v");
      vi.advanceTimersByTime(1);
      cache.set("newer", "v");
      vi.advanceTimersByTime(1);
      cache.set("newest", "v");
      expect(evicted).toEqual(["oldest"]);
      expect(cache.size()).toBe(3);
    });

    it("never evicts the just-inserted key", () => {
      const cache = new TtlCache<string>({ ttlMs: 10_000, maxEntries: 2 });
      cache.set("a", "1");
      vi.advanceTimersByTime(1);
      cache.set("b", "1");
      vi.advanceTimersByTime(1);
      cache.set("c", "1");
      expect(cache.get("c")).toBe("1");
    });

    it("purges expired entries lazily before falling back to eviction", () => {
      const evicted: string[] = [];
      const cache = new TtlCache<string>({
        ttlMs: 1_000,
        maxEntries: 2,
        onEvict: (k) => evicted.push(k),
      });
      cache.set("expiring", "v");
      vi.advanceTimersByTime(500);
      cache.set("alive", "v");
      vi.advanceTimersByTime(600);
      cache.set("incoming", "v");
      expect(evicted).toContain("expiring");
      // alive (still valid) is preserved
      expect(cache.get("alive")).toBe("v");
      expect(cache.get("incoming")).toBe("v");
    });

    it("tie-breaks on insertion order when expiresAt is identical", () => {
      const evicted: string[] = [];
      const cache = new TtlCache<string>({
        ttlMs: 10_000,
        maxEntries: 2,
        onEvict: (k) => evicted.push(k),
      });
      cache.set("first", "v");
      cache.set("second", "v");
      cache.set("third", "v");
      expect(evicted).toEqual(["first"]);
    });

    it("fires onEvicted counter hook for each eviction", () => {
      const onEvicted = vi.fn();
      const cache = new TtlCache<string>({
        ttlMs: 10_000,
        maxEntries: 1,
        onEvicted,
      });
      cache.set("a", "v");
      vi.advanceTimersByTime(1);
      cache.set("b", "v");
      expect(onEvicted).toHaveBeenCalledTimes(1);
    });

    it("onEvict hook failures never propagate out of set()", () => {
      const cache = new TtlCache<string>({
        ttlMs: 10_000,
        maxEntries: 1,
        onEvict: () => {
          throw new Error("eviction hook boom");
        },
      });
      cache.set("first", "v");
      expect(() => cache.set("second", "v")).not.toThrow();
      // The new entry still landed despite the hook throwing.
      expect(cache.get("second")).toBe("v");
    });
  });

  describe("per-key generation epochs", () => {
    it("epochOf returns 0 for never-bumped key", () => {
      const cache = new TtlCache<string>();
      expect(cache.epochOf("ghost")).toBe(0);
    });

    it("bumpEpoch monotonically increments", () => {
      const cache = new TtlCache<string>();
      cache.bumpEpoch("k");
      cache.bumpEpoch("k");
      expect(cache.epochOf("k")).toBe(2);
    });

    it("invalidate(key) bumps epoch", () => {
      const cache = new TtlCache<string>();
      cache.set("k", "v");
      cache.invalidate("k");
      expect(cache.epochOf("k")).toBe(1);
    });

    it("epoch persists across set-after-invalidate (stale-write detection)", () => {
      const cache = new TtlCache<string>();
      cache.set("k", "v1");
      cache.invalidate("k");
      // Even after invalidation removes the entry, epoch persists so a
      // late-arriving inflight write can detect staleness.
      expect(cache.epochOf("k")).toBe(1);
      cache.set("k", "v2");
      expect(cache.epochOf("k")).toBe(1);
    });

    it("evicted entries drop epoch state too", () => {
      const cache = new TtlCache<string>({ ttlMs: 10_000, maxEntries: 1 });
      cache.set("a", "v");
      cache.bumpEpoch("a");
      vi.advanceTimersByTime(1);
      cache.set("b", "v");
      expect(cache.epochOf("a")).toBe(0);
    });

    it("invalidate() with no arg bumps every existing key", () => {
      const cache = new TtlCache<string>();
      cache.set("k1", "v");
      cache.set("k2", "v");
      cache.invalidate();
      expect(cache.epochOf("k1")).toBe(1);
      expect(cache.epochOf("k2")).toBe(1);
    });
  });

  describe("invalidatePrefix", () => {
    it("removes matching entries and bumps their epochs", () => {
      const cache = new TtlCache<string>();
      cache.set("clinic-a:user-1:role:day", "v");
      cache.set("clinic-a:user-2:role:day", "v");
      cache.set("clinic-b:user-1:role:day", "v");

      const matched = cache.invalidatePrefix("clinic-a:");
      expect(matched.sort()).toEqual([
        "clinic-a:user-1:role:day",
        "clinic-a:user-2:role:day",
      ]);
      expect(cache.get("clinic-a:user-1:role:day")).toBeNull();
      expect(cache.get("clinic-a:user-2:role:day")).toBeNull();
      expect(cache.get("clinic-b:user-1:role:day")).toBe("v");
      expect(cache.epochOf("clinic-a:user-1:role:day")).toBe(1);
      expect(cache.epochOf("clinic-a:user-2:role:day")).toBe(1);
      expect(cache.epochOf("clinic-b:user-1:role:day")).toBe(0);
    });

    it("returns empty array on no matches", () => {
      const cache = new TtlCache<string>();
      cache.set("a", "v");
      expect(cache.invalidatePrefix("z:")).toEqual([]);
    });
  });
});
