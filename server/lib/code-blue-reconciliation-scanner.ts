/**
 * Fix E: Scanner for unreconciled Code Blue sessions.
 *
 * Runs every 30 minutes. Fires postSystemMessage per unreconciled session
 * when:
 *   - session is ended AND isReconciled = false
 *   - session ended more than 30 minutes ago
 *   - has not already been alerted for this session (per-session debounce)
 */

import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, codeBlueSessions } from "../db.js";
import { postSystemMessage } from "./shift-chat-presence.js";

const SCAN_INTERVAL_MS = 30 * 60 * 1000;
const MIN_AGE_MS = 30 * 60 * 1000;

/** In-process set of session IDs that have already been alerted this run cycle. */
const alertedSessions = new Set<string>();

async function scanUnreconciledCodeBlueSessions(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - MIN_AGE_MS);

    const sessions = await db
      .select({
        id: codeBlueSessions.id,
        clinicId: codeBlueSessions.clinicId,
        endedAt: codeBlueSessions.endedAt,
        patientId: codeBlueSessions.patientId,
        startedAt: codeBlueSessions.startedAt,
      })
      .from(codeBlueSessions)
      .where(
        and(
          eq(codeBlueSessions.status, "ended"),
          eq(codeBlueSessions.isReconciled, false),
          isNotNull(codeBlueSessions.endedAt),
          lt(codeBlueSessions.endedAt, cutoff),
        ),
      );

    for (const session of sessions) {
      if (alertedSessions.has(session.id)) continue;

      alertedSessions.add(session.id);

      const ageMinutes = Math.round(
        (Date.now() - (session.endedAt?.getTime() ?? Date.now())) / 60_000,
      );

      console.warn("[code-blue-reconciliation-scanner] unreconciled session detected", {
        sessionId: session.id,
        clinicId: session.clinicId,
        ageMinutes,
      });

      postSystemMessage(session.clinicId, "code_blue_unreconciled", {
        sessionId: session.id,
        patientId: session.patientId ?? null,
        endedAt: session.endedAt?.toISOString() ?? null,
        ageMinutes,
        message: `Code Blue session from ${ageMinutes} minutes ago has not been reconciled.`,
      }).catch(() => {});
    }

    // Prune alertedSessions for sessions that have since been reconciled
    // (cleared on next tick via a simple full reset if set grows large)
    if (alertedSessions.size > 500) {
      alertedSessions.clear();
    }
  } catch (err) {
    console.error("[code-blue-reconciliation-scanner] scan failed:", err);
  }
}

export function startCodeBlueReconciliationScanner(): void {
  void scanUnreconciledCodeBlueSessions().catch(() => {});
  setInterval(() => {
    void scanUnreconciledCodeBlueSessions().catch(() => {});
  }, SCAN_INTERVAL_MS);
}
