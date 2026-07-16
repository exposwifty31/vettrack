/**
 * R-RTC-1.3 — server-enforced per-socket + per-room rate limits for board events.
 *
 * A misbehaving client cannot flood the board room even if it ignores the client
 * throttle. Fixed 1-second windows per key; events over budget are DROPPED (not
 * relayed). A burst past RATE_DISCONNECT_MULTIPLIER × the budget signals the caller
 * to disconnect the socket. Pure + clock-injectable for deterministic tests.
 */
import { RATE_DISCONNECT_MULTIPLIER } from "./config.js";

export interface RateLimiter {
  /** Returns "allow" | "drop" | "disconnect" for one event on `key` at limit `perSec`. */
  check(key: string, perSec: number): "allow" | "drop" | "disconnect";
  /** Drop all counters for a socket on disconnect (prevents unbounded growth). */
  reset(prefix: string): void;
}

export function createRateLimiter(now: () => number = () => Date.now()): RateLimiter {
  // key -> { windowStartMs, count }
  const windows = new Map<string, { windowStartMs: number; count: number }>();

  return {
    check(key, perSec) {
      const t = now();
      const w = windows.get(key);
      if (!w || t - w.windowStartMs >= 1_000) {
        windows.set(key, { windowStartMs: t, count: 1 });
        return "allow";
      }
      w.count += 1;
      if (w.count > perSec * RATE_DISCONNECT_MULTIPLIER) return "disconnect";
      if (w.count > perSec) return "drop";
      return "allow";
    },
    reset(prefix) {
      for (const key of windows.keys()) {
        if (key.startsWith(prefix)) windows.delete(key);
      }
    },
  };
}

/** Validate a normalized cursor coordinate: finite number in [0,1]. */
export function isNormalizedCoord(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** Reject oversized payloads (R-RTC-1.3: ≤ 2 KB). */
export function isWithinByteLimit(payload: unknown, maxBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}
