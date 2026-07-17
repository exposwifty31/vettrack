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
  /** Drop every counter whose key starts with `prefix` (disconnect cleanup — no unbounded growth). */
  reset(prefix: string): void;
  /** Inspection seam (tests/diagnostics): a snapshot of the live window keys. Never used in hot paths. */
  keys(): string[];
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
    keys() {
      return [...windows.keys()];
    },
  };
}

/**
 * The per-socket rate-limit verbs — the single source of truth for the control-event
 * keys. Every per-socket key is namespaced `${socketId}:${verb}` (see `socketRateKey`),
 * so the ENTIRE disconnect cleanup collapses to one `reset(socketRateKeyPrefix(id))` and
 * a newly added verb can never leak a windows-Map key through a forgotten per-verb reset.
 *
 * NOTE: the board per-ROOM aggregate ("curroom:<room>") is intentionally NOT here — it is
 * shared across every socket in a room and must survive any single socket's disconnect.
 */
export const COLLAB_RATE_VERBS = {
  join: "join",
  typing: "typing",
  nudge: "nudge",
  cursor: "cur",
  selection: "sel",
  recordPresence: "recpres",
  leave: "leave",
} as const;
export type CollabRateVerb = (typeof COLLAB_RATE_VERBS)[keyof typeof COLLAB_RATE_VERBS];

/** Build a per-socket rate-limit key: a per-socket sub-scope so one prefix-clear covers all verbs. */
export function socketRateKey(socketId: string, verb: CollabRateVerb): string {
  return `${socketId}:${verb}`;
}

/** The prefix matching EVERY per-socket rate-limit key for one socket (disconnect cleanup). */
export function socketRateKeyPrefix(socketId: string): string {
  return `${socketId}:`;
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
