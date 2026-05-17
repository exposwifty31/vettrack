// Phase 9 PR 9.4 — Code Blue SSE keepalive + reconnect-storm detection.
//
// Emits a structured `KEEPALIVE` event on each SSE connection every
// KEEPALIVE_INTERVAL_MS with a bounded payload:
//
//   {
//     type: "KEEPALIVE",
//     payload: {
//       activeCodeBlueSessionId: string | null,
//       stormHint: "none" | "elevated"
//     }
//   }
//
// Contract (plan §3.3, §3.4, §3.5):
//   - The keepalive payload carries operational reconciliation only. It is
//     never an input to authority, audit, billing, enforcement, or clinical
//     code paths.
//   - `stormHint` is a bounded enum. No numeric retry durations, percentages,
//     load factors, timestamps, dynamic throttling payloads, or arbitrary
//     metadata appear in this field. The client uses `"elevated"` only to
//     apply additional bounded jitter on top of its degraded-mode polling.
//   - The active session id is looked up from a short-TTL in-process cache so
//     this hot path never hits the DB on every emission.
//   - Reconnect-storm detection counts connects per clinic in a 5 s window.
//     When the count crosses STORM_THRESHOLD we publish `stormHint=elevated`
//     for STORM_DURATION_MS and increment the bounded counter.

import { and, eq, sql } from "drizzle-orm";
import type { Response } from "express";
import { codeBlueSessions, db } from "../db.js";
import { incrementMetric } from "./metrics.js";

const KEEPALIVE_INTERVAL_MS = 10_000;
const ACTIVE_CB_CACHE_TTL_MS = 5_000;
const STORM_WINDOW_MS = 5_000;
const STORM_THRESHOLD = 50;
const STORM_DURATION_MS = 30_000;

type ActiveCbCacheEntry = { sessionId: string | null; expiresAt: number };
const activeCbCache = new Map<string, ActiveCbCacheEntry>();

// Phase 9 pre-merge kill pass — per-clinic invalidation generation.
// Bumps every time `invalidateActiveCodeBlueCache` runs. `getActiveCbSessionId`
// captures the generation BEFORE issuing its DB query and only writes the
// resulting value back into the cache if the generation hasn't changed by
// the time the query returns. Without this, a CB session end that fires
// `invalidateActiveCodeBlueCache` mid-query would still see the stale
// (pre-end) session id written back into the cache for the next 5 s.
const cacheGenerationByClinic = new Map<string, number>();
function readCacheGeneration(clinicId: string): number {
  return cacheGenerationByClinic.get(clinicId) ?? 0;
}

const reconnectTimestamps = new Map<string, number[]>();
const stormUntil = new Map<string, number>();

async function readActiveCbSessionId(clinicId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ id: codeBlueSessions.id })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")))
      .orderBy(sql`${codeBlueSessions.startedAt} desc`)
      .limit(1);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function getActiveCbSessionId(clinicId: string): Promise<string | null> {
  const now = Date.now();
  const cached = activeCbCache.get(clinicId);
  if (cached && cached.expiresAt > now) return cached.sessionId;
  const generationAtStart = readCacheGeneration(clinicId);
  const fresh = await readActiveCbSessionId(clinicId);
  // Only repopulate the cache if no invalidation arrived during the DB
  // query. Otherwise we'd serve the now-stale value to subsequent
  // keepalives for up to ACTIVE_CB_CACHE_TTL_MS, telling clients the
  // session is still active after it has ended (or vice versa).
  if (readCacheGeneration(clinicId) === generationAtStart) {
    activeCbCache.set(clinicId, { sessionId: fresh, expiresAt: now + ACTIVE_CB_CACHE_TTL_MS });
  }
  return fresh;
}

/** Invalidate the cached active session id for a clinic — called by code-blue
 * mutation handlers (start/end) so subsequent keepalives reflect reality.
 *
 * Bumps the per-clinic generation counter so any DB lookup currently
 * in flight will refuse to write its (now-stale) result back into the
 * cache — see `getActiveCbSessionId` for the matching guard. */
export function invalidateActiveCodeBlueCache(clinicId: string): void {
  activeCbCache.delete(clinicId);
  cacheGenerationByClinic.set(clinicId, readCacheGeneration(clinicId) + 1);
}

export function recordStreamConnect(clinicId: string): void {
  const now = Date.now();
  const cutoff = now - STORM_WINDOW_MS;
  const list = (reconnectTimestamps.get(clinicId) ?? []).filter((ts) => ts >= cutoff);
  list.push(now);
  reconnectTimestamps.set(clinicId, list);
  if (list.length >= STORM_THRESHOLD) {
    const wasElevated = (stormUntil.get(clinicId) ?? 0) > now;
    stormUntil.set(clinicId, now + STORM_DURATION_MS);
    if (!wasElevated) {
      incrementMetric("realtime_reconnect_storm_detected");
    }
  }
}

export function getStormHint(clinicId: string): "none" | "elevated" {
  const until = stormUntil.get(clinicId) ?? 0;
  return until > Date.now() ? "elevated" : "none";
}

function safeWriteSse(res: Response, chunk: string): boolean {
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the keepalive emitter for one SSE connection. Returns a cleanup
 * function that the route handler calls on connection close.
 */
export function startKeepalive(res: Response, clinicId: string): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    cancelled = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function emit(): Promise<void> {
    if (cancelled) return;
    try {
      const [activeCodeBlueSessionId, stormHint] = await Promise.all([
        getActiveCbSessionId(clinicId),
        Promise.resolve(getStormHint(clinicId)),
      ]);
      // Re-check after the (potentially DB-bound) await: if `stop()` ran
      // during the lookup — e.g. the SSE connection closed and the route
      // handler's cleanup fired — we must not write to the response. The
      // `safeWriteSse` try/catch would swallow the error, but skipping the
      // write entirely avoids wasted work and a misleading attempt-count.
      if (cancelled) return;
      const envelope = {
        type: "KEEPALIVE" as const,
        payload: {
          activeCodeBlueSessionId,
          stormHint,
        },
        timestamp: new Date().toISOString(),
      };
      // safeWriteSse returns false when the underlying socket has already
      // been torn down. The route handler's `close` event eventually fires
      // the cleanup callback returned by this function, but there's a
      // window in which the interval would otherwise keep firing futile
      // writes every 10 s. Self-cancel on first failed write.
      if (!safeWriteSse(res, `data: ${JSON.stringify(envelope)}\n\n`)) {
        stop();
      }
    } catch {
      // Keepalive emission is best-effort; never break the connection.
    }
  }

  timer = setInterval(() => {
    void emit();
  }, KEEPALIVE_INTERVAL_MS);
  // Emit the first keepalive promptly so the client doesn't wait 10 s for the
  // initial activeCodeBlueSessionId signal.
  void emit();

  return stop;
}

/** Test-only — clear in-process state between cases. */
export function _resetCodeBlueKeepaliveForTests(): void {
  activeCbCache.clear();
  reconnectTimestamps.clear();
  stormUntil.clear();
  cacheGenerationByClinic.clear();
}

/** Test-only — exposes the otherwise private cache-lookup helper so the
 * invalidation-generation race regression can be exercised
 * deterministically without spinning up a full SSE harness. */
export function __getActiveCbSessionIdForTests(clinicId: string): Promise<string | null> {
  return getActiveCbSessionId(clinicId);
}
