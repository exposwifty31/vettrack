/**
 * R-M1.1d — Reader-offline detection sweep.
 *
 * Computes reader staleness from vt_rfid_readers.last_reader_heartbeat_at — the reader's OWN
 * heartbeat (a heartbeat ping OR an accepted ingest batch from that reader; see
 * server/lib/rfid-ingest.ts). It NEVER reads equipment.last_rfid* asset traffic, so a
 * healthy-but-quiet reader with no equipment passing it is not marked offline.
 *
 * The persisted reader_health_status column carries the last-known state so the sweep can emit
 * the `rfid_reader_offline` signal (which feeds R-M1.3) and its clear ONLY on a status CHANGE:
 *   - healthy -> offline  ⇒ one RFID_READER_OFFLINE outbox row
 *   - offline -> healthy  ⇒ one RFID_READER_RECOVERED outbox row
 * A compare-and-set on reader_health_status makes the flip idempotent under concurrent sweeps, so
 * exactly one signal fires per genuine transition and a run over an unchanged fleet emits nothing.
 *
 * RFID is advisory-only (ADR-006): this sweep writes ONLY vt_rfid_readers + the outbox — never
 * custody, never equipment.
 */

import { and, eq } from "drizzle-orm";
import { db, rfidReaders } from "../../db.js";
import { logAudit } from "../audit.js";
import { incrementMetric } from "../metrics.js";
import { insertRealtimeDomainEvent } from "../realtime-outbox.js";
import {
  READER_HEARTBEAT_ONLINE_WINDOW_MS,
  managedReaderHealthWithThreshold,
  toPersistedReaderHealth,
} from "../../../shared/rfid-readers.js";

export const RFID_READER_OFFLINE_EVENT = "RFID_READER_OFFLINE";
export const RFID_READER_RECOVERED_EVENT = "RFID_READER_RECOVERED";

/** Fixed scheduler cadence: sweep once a minute (well below the default staleness window). */
const SWEEP_INTERVAL_MS = 60 * 1000;

const SYSTEM_USER_ID = "system:rfid-reader-offline";
const SYSTEM_USER_EMAIL = "rfid-reader-offline@vettrack.system";

/**
 * Per-clinic staleness threshold. The window is the shared reader-heartbeat window by default;
 * an env override applies fleet-wide (a genuine per-clinic override is future config — the
 * clinicId parameter is the seam so callers never fork the computation).
 */
export function resolveReaderStalenessThresholdMs(_clinicId: string): number {
  const raw = Number(process.env.RFID_READER_OFFLINE_THRESHOLD_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : READER_HEARTBEAT_ONLINE_WINDOW_MS;
}

export async function runRfidReaderOfflineSweep(
  now: Date = new Date(),
): Promise<{ scanned: number; wentOffline: number; recovered: number }> {
  const nowMs = now.getTime();

  // Only active readers are health-checked; a deactivated (inactive) reader is excluded from live
  // status (its persisted health is left untouched and raises no signal).
  const readers = await db
    .select({
      id: rfidReaders.id,
      clinicId: rfidReaders.clinicId,
      lastReaderHeartbeatAt: rfidReaders.lastReaderHeartbeatAt,
      readerHealthStatus: rfidReaders.readerHealthStatus,
    })
    .from(rfidReaders)
    .where(eq(rfidReaders.status, "active"));

  let wentOffline = 0;
  let recovered = 0;

  for (const reader of readers) {
    const threshold = resolveReaderStalenessThresholdMs(reader.clinicId);
    const heartbeatIso = reader.lastReaderHeartbeatAt
      ? reader.lastReaderHeartbeatAt.toISOString()
      : null;
    const derived = managedReaderHealthWithThreshold(heartbeatIso, nowMs, threshold);
    const target = toPersistedReaderHealth(derived);
    const prior = reader.readerHealthStatus;

    if (target === prior) continue; // no change — dedup: no write, no signal

    // Compare-and-set: only the sweep observing `prior` flips the row, so overlapping sweeps
    // never double-emit. Clinic-scoped write (tenant safety).
    const updated = await db
      .update(rfidReaders)
      .set({ readerHealthStatus: target, readerHealthChangedAt: now })
      .where(
        and(
          eq(rfidReaders.clinicId, reader.clinicId),
          eq(rfidReaders.id, reader.id),
          eq(rfidReaders.readerHealthStatus, prior),
        ),
      )
      .returning({ id: rfidReaders.id });
    if (updated.length === 0) continue; // lost the race to a concurrent sweep

    // Emit ONLY on the two health transitions. unknown->healthy (first observation) and
    // unknown->offline (a never-healthy reader) persist silently so the board isn't spammed.
    if (prior === "healthy" && target === "offline") {
      wentOffline += 1;
      incrementMetric("rfid_reader_offline_detected");
      await insertRealtimeDomainEvent(db, {
        clinicId: reader.clinicId,
        type: RFID_READER_OFFLINE_EVENT,
        category: "ALERT",
        level: "WARNING",
        payload: { readerId: reader.id, at: now.toISOString() },
        occurredAt: now,
      });
      logAudit({
        clinicId: reader.clinicId,
        actionType: "rfid_reader_offline",
        performedBy: SYSTEM_USER_ID,
        performedByEmail: SYSTEM_USER_EMAIL,
        targetId: reader.id,
        targetType: "rfid_reader",
        metadata: { lastReaderHeartbeatAt: heartbeatIso },
      });
    } else if (prior === "offline" && target === "healthy") {
      recovered += 1;
      incrementMetric("rfid_reader_recovered");
      await insertRealtimeDomainEvent(db, {
        clinicId: reader.clinicId,
        type: RFID_READER_RECOVERED_EVENT,
        category: "ALERT",
        level: "INFO",
        payload: { readerId: reader.id, at: now.toISOString() },
        occurredAt: now,
      });
      logAudit({
        clinicId: reader.clinicId,
        actionType: "rfid_reader_recovered",
        performedBy: SYSTEM_USER_ID,
        performedByEmail: SYSTEM_USER_EMAIL,
        targetId: reader.id,
        targetType: "rfid_reader",
        metadata: { lastReaderHeartbeatAt: heartbeatIso },
      });
    }
  }

  return { scanned: readers.length, wentOffline, recovered };
}

let sweepStarted = false;

/** Fixed-cadence scheduler; registered in server/app/start-schedulers.ts. */
export function startRfidReaderOfflineSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  void runRfidReaderOfflineSweep().catch((err) => {
    console.error("[rfid-reader-offline] startup sweep failed:", err);
  });
  setInterval(() => {
    void runRfidReaderOfflineSweep().catch((err) => {
      console.error("[rfid-reader-offline] sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);
}

export const __test = { SWEEP_INTERVAL_MS };
