const DEFAULT_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  /**
   * Optional hook fired when soft-cap eviction discards an entry. Used by the
   * authority cache to drop matching inflight/epoch state in the same step.
   * Must never throw.
   */
  onEvict?: (key: string) => void;
  /**
   * Optional hook fired when an internal cache operation (eviction sweep,
   * write) throws. Used by the authority cache to bump
   * authority_cache_error_set. Must never throw.
   */
  onSetError?: () => void;
  /**
   * Optional hook fired each time soft-cap eviction discards an entry. Used by
   * the authority cache to bump authority_cache_evicted.
   */
  onEvicted?: () => void;
}

class TtlCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private epochs = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly onEvict?: (key: string) => void;
  private readonly onSetError?: () => void;
  private readonly onEvicted?: () => void;

  constructor(options: TtlCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
    this.onEvict = options.onEvict;
    this.onSetError = options.onSetError;
    this.onEvicted = options.onEvicted;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    try {
      const alreadyPresent = this.entries.has(key);
      if (
        !alreadyPresent &&
        Number.isFinite(this.maxEntries) &&
        this.entries.size >= this.maxEntries
      ) {
        this.purgeExpiredOnce();
      }
      if (
        !alreadyPresent &&
        Number.isFinite(this.maxEntries) &&
        this.entries.size >= this.maxEntries
      ) {
        this.evictOne();
      }
      this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    } catch {
      try {
        this.onSetError?.();
      } catch {
        // Hook must never propagate.
      }
    }
  }

  invalidate(key?: string): void {
    if (key) {
      this.bumpEpoch(key);
      this.entries.delete(key);
      return;
    }
    for (const k of this.entries.keys()) {
      this.bumpEpoch(k);
    }
    this.entries.clear();
  }

  invalidatePrefix(prefix: string): string[] {
    const matched: string[] = [];
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) matched.push(k);
    }
    for (const k of matched) {
      this.bumpEpoch(k);
      this.entries.delete(k);
    }
    return matched;
  }

  epochOf(key: string): number {
    return this.epochs.get(key) ?? 0;
  }

  bumpEpoch(key: string): void {
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Test-only escape hatch. Resets entries AND epochs so tests start with a
   * clean slate. Production code uses invalidate()/invalidatePrefix() which
   * intentionally preserve epoch counters for stale-write detection.
   */
  resetForTests(): void {
    this.entries.clear();
    this.epochs.clear();
  }

  private purgeExpiredOnce(): void {
    const now = Date.now();
    for (const [k, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(k);
        this.epochs.delete(k);
        try {
          this.onEvict?.(k);
        } catch {
          // Hook must never propagate.
        }
      }
    }
  }

  private evictOne(): void {
    // Map iteration is insertion-ordered in JS, so the first key with the
    // lowest expiresAt is deterministically the oldest insertion among ties.
    let victimKey: string | null = null;
    let victimExpiry = Number.POSITIVE_INFINITY;
    for (const [k, entry] of this.entries) {
      if (entry.expiresAt < victimExpiry) {
        victimExpiry = entry.expiresAt;
        victimKey = k;
      }
    }
    if (victimKey === null) return;
    this.entries.delete(victimKey);
    this.epochs.delete(victimKey);
    try {
      this.onEvict?.(victimKey);
    } catch {
      // Hook must never propagate.
    }
    try {
      this.onEvicted?.();
    } catch {
      // Hook must never propagate.
    }
  }
}

export { TtlCache };

export const analyticsCache = new TtlCache<unknown>();

export function invalidateAnalyticsCache(clinicId?: string): void {
  analyticsCache.invalidate(clinicId);
}
