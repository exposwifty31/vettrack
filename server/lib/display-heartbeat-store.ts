// Phase 9 PR 9.2 — Department Display heartbeat liveness store.
//
// Non-persistent, operational-only state.
//
// Contract (see plan §3.2):
//   - No DB writes. No new tables.
//   - No persistent device identity. State expires via TTL.
//   - Redis with short TTL preferred; bounded in-process Map as fallback.
//   - Coalesce by displaySessionId: any heartbeat arriving within COALESCE_MS
//     of the previous one for the same session is dropped silently (no counter
//     increment, no error).
//   - No userId / clinicId / requestId / IP / UA / device ID labels.
//   - Heartbeat presence/absence has no clinical meaning and never gates any
//     clinical, authority, audit, billing, or enforcement decision.
//
// `displaySessionId` is a short-lived client-minted random value scoped to a
// browser tab's sessionStorage lifetime. It is used only as an internal
// rate-limit/coalescing key. It is never used as a metric label, audit field,
// clinical identifier, authority input, billing input, or persistent device
// identity (see plan §3.2).

import { getRedis, recordRedisFallback, timedRedisOp } from "./redis.js";

export const HEARTBEAT_TTL_MS = 90_000; // 3× heartbeat cadence
export const COALESCE_MS = 10_000;
const FALLBACK_MAP_MAX_SIZE = 5_000;
const ALIVE_WINDOW_MS = 60_000;

const REDIS_PREFIX = "vettrack:display_hb:";

type HeartbeatEntry = {
  /** Last accepted (non-coalesced) heartbeat timestamp in ms since epoch. */
  lastAcceptedAtMs: number;
  /** Whether the latest accepted heartbeat reported kiosk mode. Bounded enum. */
  kioskMode: boolean;
};

// In-process fallback map. Bounded to prevent memory growth. Expired entries
// are evicted lazily on access; size cap enforced on insert.
const fallbackMap = new Map<string, HeartbeatEntry>();

function nowMs(): number {
  return Date.now();
}

/** Strip any character outside [a-zA-Z0-9_-] and clamp length to 64. */
function sanitizeSessionId(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
  if (cleaned.length === 0 || cleaned.length > 64) return null;
  return cleaned;
}

function redisKey(sessionId: string): string {
  return `${REDIS_PREFIX}${sessionId}`;
}

function isExpired(entry: HeartbeatEntry, now: number): boolean {
  return entry.lastAcceptedAtMs + HEARTBEAT_TTL_MS < now;
}

function evictFallbackIfNeeded(): void {
  if (fallbackMap.size < FALLBACK_MAP_MAX_SIZE) return;
  const now = nowMs();
  for (const [id, entry] of fallbackMap) {
    if (isExpired(entry, now)) fallbackMap.delete(id);
    if (fallbackMap.size < FALLBACK_MAP_MAX_SIZE) return;
  }
  // Still over capacity after expiry sweep — drop the oldest entries.
  if (fallbackMap.size >= FALLBACK_MAP_MAX_SIZE) {
    const sorted = [...fallbackMap.entries()].sort(
      (a, b) => a[1].lastAcceptedAtMs - b[1].lastAcceptedAtMs,
    );
    const toDrop = sorted.slice(0, Math.max(1, Math.floor(FALLBACK_MAP_MAX_SIZE / 10)));
    for (const [id] of toDrop) fallbackMap.delete(id);
  }
}

async function getEntryFromRedis(sessionId: string): Promise<HeartbeatEntry | null> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("displayHeartbeat:get");
    return null;
  }
  try {
    const raw = await timedRedisOp("displayHeartbeat:get", () => r.get(redisKey(sessionId)));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HeartbeatEntry>;
    if (typeof parsed.lastAcceptedAtMs !== "number" || !Number.isFinite(parsed.lastAcceptedAtMs)) {
      return null;
    }
    return {
      lastAcceptedAtMs: parsed.lastAcceptedAtMs,
      kioskMode: parsed.kioskMode === true,
    };
  } catch {
    return null;
  }
}

async function setEntryInRedis(sessionId: string, entry: HeartbeatEntry): Promise<void> {
  const r = await getRedis();
  if (!r) {
    recordRedisFallback("displayHeartbeat:set");
    return;
  }
  try {
    const ttlSec = Math.ceil(HEARTBEAT_TTL_MS / 1000);
    await timedRedisOp("displayHeartbeat:set", () =>
      r.set(redisKey(sessionId), JSON.stringify(entry), "EX", ttlSec),
    );
  } catch {
    // best-effort
  }
}

export type HeartbeatAcceptResult =
  | { accepted: true; kioskMode: boolean }
  | { accepted: false; reason: "coalesced" };

/**
 * Record a heartbeat. Returns whether the heartbeat was accepted (and the
 * caller should increment its bounded counter) or coalesced (the caller must
 * NOT increment any counter, must return 2xx no-op).
 */
export async function recordHeartbeat(args: {
  rawSessionId: unknown;
  kioskMode: boolean;
}): Promise<HeartbeatAcceptResult | { accepted: false; reason: "invalid" }> {
  const sessionId = typeof args.rawSessionId === "string" ? sanitizeSessionId(args.rawSessionId) : null;
  if (!sessionId) return { accepted: false, reason: "invalid" };

  const now = nowMs();
  const existing =
    (await getEntryFromRedis(sessionId)) ??
    fallbackMap.get(sessionId) ??
    null;

  if (existing && !isExpired(existing, now) && now - existing.lastAcceptedAtMs < COALESCE_MS) {
    return { accepted: false, reason: "coalesced" };
  }

  const next: HeartbeatEntry = {
    lastAcceptedAtMs: now,
    kioskMode: args.kioskMode,
  };
  evictFallbackIfNeeded();
  fallbackMap.set(sessionId, next);
  await setEntryInRedis(sessionId, next);
  return { accepted: true, kioskMode: args.kioskMode };
}

/**
 * Count distinct sessions with an accepted heartbeat in the last
 * ALIVE_WINDOW_MS (60s). Uses fallback Map only (Redis is per-key TTL and
 * scanning is too expensive for a hot gauge read).
 */
export function getAliveCount(): number {
  const cutoff = nowMs() - ALIVE_WINDOW_MS;
  let alive = 0;
  for (const entry of fallbackMap.values()) {
    if (entry.lastAcceptedAtMs >= cutoff) alive += 1;
  }
  return alive;
}

/** Test-only — clear in-memory state between test cases. */
export function _resetDisplayHeartbeatStoreForTests(): void {
  fallbackMap.clear();
}
