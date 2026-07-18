/**
 * R-SH-F1.2 — Shift-end scheduler wiring for the handover generator.
 *
 * There is NO public HTTP generate route in v1. The only trigger is this
 * in-process scanner: it periodically finds `vt_shift_sessions` rows that ended
 * recently and calls `generateShiftHandover(clinicId, sessionId)` with NO opts
 * — the retry-safe idempotent path. Because generate is idempotent per
 * `shiftSessionId`, re-scanning the same ended session never produces a
 * duplicate artifact, so the scan needs no external debounce.
 *
 * `clinicId` is system-derived (read off the scanned session row) — never from
 * request input. The scan read carries an explicit `clinicId`-bearing session
 * row; the generator carries the explicit `clinicId` predicate on every read.
 */
import { and, gte, isNotNull, lt } from "drizzle-orm";
import { db, shiftSessions } from "../db.js";
import { generateShiftHandover } from "./shift-handover-generator.js";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
/** Look back a little further than one interval so a slow tick never drops a session. */
const LOOKBACK_MS = 15 * 60 * 1000;

async function scanEndedShiftsForHandover(): Promise<void> {
  try {
    const now = Date.now();
    const since = new Date(now - LOOKBACK_MS);
    const until = new Date(now);

    const ended = await db
      .select({ id: shiftSessions.id, clinicId: shiftSessions.clinicId })
      .from(shiftSessions)
      .where(
        and(
          isNotNull(shiftSessions.endedAt),
          gte(shiftSessions.endedAt, since),
          lt(shiftSessions.endedAt, until),
        ),
      );

    for (const session of ended) {
      try {
        await generateShiftHandover(session.clinicId, session.id);
      } catch (err) {
        console.error("[shift-handover-scheduler] generate failed", {
          sessionId: session.id,
          clinicId: session.clinicId,
          err,
        });
      }
    }
  } catch (err) {
    console.error("[shift-handover-scheduler] scan failed:", err);
  }
}

export function startShiftHandoverScheduler(): void {
  void scanEndedShiftsForHandover().catch(() => {});
  setInterval(() => {
    void scanEndedShiftsForHandover().catch(() => {});
  }, SCAN_INTERVAL_MS);
}
