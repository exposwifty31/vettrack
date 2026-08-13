/**
 * Doctor check-in auto-expiry sweep (doctor shift gate, spec 2026-08-13).
 *
 * Closes forgotten DOCTOR-GATE check-ins after 14 hours with one UPDATE.
 * Targeting rides on the immutable `check_in_source` column (migration 184),
 * classified ONCE at insert by the check-in service:
 *
 *  - `icu` / `internal_medicine` rows are always 'doctor_gate' — these role
 *    values did not exist before the doctor gate.
 *  - `admission` is ambiguous: the gate client declares provenance
 *    explicitly (request `source: "doctor_gate"`, route-validated literal);
 *    a request without it — every legacy surface — stamps 'legacy'.
 *    Persisting the verdict at insert keeps the sweep immune to later
 *    allowlist edits; the field controls expiry only, never privileges.
 *  - Technician rows (operational_role NULL) and legacy-only roles (`ward`,
 *    `senior_lead`, `night_*`) are 'legacy' by construction — untouchable.
 *
 * Every closed row gets the same writer-side treatment as the sibling close
 * paths in the check-in service: a `clinical_check_out`
 * audit row (system actor, source "auto_expired") and a per-user
 * authority-cache invalidation — an auto-expired doctor must not keep
 * check-in-derived authority for the cache TTL.
 *
 * Deliberately SEPARATE from the shadow/read-only staleCheckInSweepWorker
 * (Phase 2.5 PR 5.2) — that worker observes and never mutates; this one is the
 * doctor-only mutation path. Do not merge them.
 *
 * In-process interval scheduler (hourly), registered in
 * server/app/start-schedulers.ts. No Redis / BullMQ dependency.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { clinicalCheckIns, db } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { invalidateForUser } from "../lib/authority-cache.js";

/** Spec-fixed threshold: a doctor check-in older than this is auto-expired. */
export const DOCTOR_CHECKIN_EXPIRY_HOURS = 14;

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

export async function sweepExpiredDoctorCheckIns(
  now: Date = new Date(),
): Promise<{ closedCount: number }> {
  const cutoff = new Date(now.getTime() - DOCTOR_CHECKIN_EXPIRY_HOURS * 3_600_000);
  const closed = await db
    .update(clinicalCheckIns)
    .set({ checkedOutAt: now, checkOutReason: "auto_expired" })
    .where(
      and(
        isNull(clinicalCheckIns.checkedOutAt),
        lt(clinicalCheckIns.checkedInAt, cutoff),
        eq(clinicalCheckIns.checkInSource, "doctor_gate"),
      ),
    )
    .returning({
      id: clinicalCheckIns.id,
      clinicId: clinicalCheckIns.clinicId,
      userId: clinicalCheckIns.userId,
      operationalRole: clinicalCheckIns.operationalRole,
    });

  for (const row of closed) {
    // Writer-side invalidation contract: mirror every sibling close path so
    // resolveAuthority never serves a stale open check-in past this close.
    invalidateForUser(row.clinicId, row.userId);
    // Fire-and-forget, mirrors autoCheckOutForSessionEnd. An auto-expiry is a
    // clinical-authority state change — it must be visible in vt_audit_logs.
    logAudit({
      clinicId: row.clinicId,
      actionType: "clinical_check_out",
      performedBy: "system:doctor_checkin_expiry",
      performedByEmail: "system",
      targetId: row.id,
      targetType: "clinical_check_in",
      metadata: {
        checkInId: row.id,
        clinicId: row.clinicId,
        userId: row.userId,
        operationalRole: row.operationalRole,
        source: "auto_expired",
      },
    });
  }

  if (closed.length > 0) {
    console.log(
      `[doctor-checkin-expiry] auto-expired ${closed.length} doctor check-in(s): ` +
        closed.map((r) => `${r.clinicId}:${String(r.id).slice(0, 8)}`).join(", "),
    );
  }
  return { closedCount: closed.length };
}

export function startDoctorCheckInExpiryWorker(): void {
  setInterval(() => {
    sweepExpiredDoctorCheckIns().catch((err) => {
      console.error("[doctor-checkin-expiry] sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);

  // Immediate boot sweep — catches rows stranded across a server restart.
  void sweepExpiredDoctorCheckIns().catch((err) => {
    console.error("[doctor-checkin-expiry] sweep failed:", err);
  });

  console.log(
    `[doctor-checkin-expiry] worker started (interval ${SWEEP_INTERVAL_MS / 60_000} min, threshold ${DOCTOR_CHECKIN_EXPIRY_HOURS}h)`,
  );
}
