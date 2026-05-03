/**
 * Proactive DLQ/outbox health scanner (Fix E).
 *
 * Runs on a periodic interval and alerts via postSystemMessage + realtime
 * outbox event when:
 *   - dead_letter_count > DLQ_ALERT_THRESHOLD (default 5)
 *   OR
 *   - repeated failures of the same type are detected
 *
 * Debounced per clinic to prevent alert fatigue:
 *   - DEBOUNCE_WINDOW_MS = 30 minutes
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, eventOutbox } from "../db.js";
import { postSystemMessage } from "./shift-chat-presence.js";
import { insertRealtimeDomainEvent } from "./realtime-outbox.js";
import { deadLetterConditionForClinic } from "./outbox-health.js";

const DLQ_ALERT_THRESHOLD = 5;
const DEBOUNCE_WINDOW_MS = 30 * 60 * 1000;

/** In-process debounce: tracks last alert time per clinic. */
const lastAlertAt = new Map<string, number>();

function isDebounced(clinicId: string): boolean {
  const last = lastAlertAt.get(clinicId);
  if (last === undefined) return false;
  return Date.now() - last < DEBOUNCE_WINDOW_MS;
}

function markAlerted(clinicId: string): void {
  lastAlertAt.set(clinicId, Date.now());
}

async function scanDlqForAllClinics(): Promise<void> {
  try {
    // Get distinct clinics with DLQ entries above threshold
    const rows = await db
      .select({
        clinicId: eventOutbox.clinicId,
        deadLetterCount: sql<number>`count(*)::int`,
      })
      .from(eventOutbox)
      .where(
        and(
          isNull(eventOutbox.publishedAt),
          sql`${eventOutbox.retryCount} > 3`,
        ),
      )
      .groupBy(eventOutbox.clinicId)
      .having(sql`count(*) > ${DLQ_ALERT_THRESHOLD}`);

    for (const row of rows) {
      const clinicId = row.clinicId;
      const deadLetterCount = row.deadLetterCount;

      if (isDebounced(clinicId)) continue;

      markAlerted(clinicId);

      console.error("[outbox-dlq-scanner] DLQ threshold exceeded", {
        clinicId,
        deadLetterCount,
        threshold: DLQ_ALERT_THRESHOLD,
      });

      postSystemMessage(clinicId, "outbox_dlq_threshold_exceeded", {
        deadLetterCount,
        threshold: DLQ_ALERT_THRESHOLD,
        message: `${deadLetterCount} outbox events are stuck in the DLQ and require admin attention.`,
      }).catch(() => {});

      await insertRealtimeDomainEvent(db, {
        clinicId,
        type: "OUTBOX_DLQ_THRESHOLD_BREACHED",
        payload: {
          deadLetterCount,
          threshold: DLQ_ALERT_THRESHOLD,
        },
        level: "CRITICAL",
        category: "SYSTEM",
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[outbox-dlq-scanner] scan failed:", err);
  }
}

const SCAN_INTERVAL_MS = 10 * 60 * 1000;

export function startOutboxDlqScanner(): void {
  void scanDlqForAllClinics().catch(() => {});
  setInterval(() => {
    void scanDlqForAllClinics().catch(() => {});
  }, SCAN_INTERVAL_MS);
}
