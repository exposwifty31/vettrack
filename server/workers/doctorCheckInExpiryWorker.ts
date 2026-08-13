/**
 * Doctor check-in auto-expiry sweep (doctor shift gate, spec 2026-08-13).
 *
 * Closes forgotten DOCTOR check-ins after 14 hours: one clinic-agnostic UPDATE
 * whose WHERE clause filters `operational_role IN ('icu','admission',
 * 'internal_medicine')` (imported DOCTOR_TEAM_ROLES), so technician rows
 * (operational_role NULL) and legacy-role vet rows (`ward`, `senior_lead`,
 * `night_*`) are untouchable by construction. Per-row clinicId is preserved in
 * the RETURNING set for logging.
 *
 * Deliberately SEPARATE from the shadow/read-only staleCheckInSweepWorker
 * (Phase 2.5 PR 5.2) — that worker observes and never mutates; this one is the
 * doctor-only mutation path. Do not merge them.
 *
 * In-process interval scheduler (hourly), registered in
 * server/app/start-schedulers.ts. No Redis / BullMQ dependency.
 */
import { and, inArray, isNull, lt } from "drizzle-orm";
import { clinicalCheckIns, db } from "../db.js";
import { DOCTOR_TEAM_ROLES } from "../services/clinical-check-in.js";

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
        inArray(clinicalCheckIns.operationalRole, [...DOCTOR_TEAM_ROLES]),
        lt(clinicalCheckIns.checkedInAt, cutoff),
      ),
    )
    .returning({ id: clinicalCheckIns.id, clinicId: clinicalCheckIns.clinicId });

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
