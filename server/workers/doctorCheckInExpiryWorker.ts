/**
 * Doctor check-in auto-expiry sweep (doctor shift gate, spec 2026-08-13).
 *
 * Closes forgotten DOCTOR-GATE check-ins after 14 hours with one UPDATE.
 * Targeting is deliberately conservative:
 *
 *  - `icu` / `internal_medicine` rows are swept unconditionally — these role
 *    values did not exist before the doctor gate, so every such row is a
 *    gate row by construction.
 *  - `admission` is ambiguous: it pre-exists as a legacy allowlist role, and
 *    pre-feature rows could ONLY be created by vets whose
 *    `allowedOperationalRoles` contains "admission". Those rows (and any new
 *    row by an allowlisted user) are excluded via a clinic-scoped NOT EXISTS
 *    allowlist probe — the sweep never mutates a check-in that legacy
 *    semantics could have produced, so clinics that never adopted the gate
 *    keep their authority resolution untouched.
 *  - Technician rows (operational_role NULL) and legacy-only roles (`ward`,
 *    `senior_lead`, `night_*`) are untouchable by construction.
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
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { clinicalCheckIns, db, users } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { invalidateForUser } from "../lib/authority-cache.js";
import { DOCTOR_TEAM_ROLES } from "../services/clinical-check-in.js";

/** Spec-fixed threshold: a doctor check-in older than this is auto-expired. */
export const DOCTOR_CHECKIN_EXPIRY_HOURS = 14;

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Team roles that can ONLY originate from the doctor gate (safe to sweep unconditionally). */
const GATE_ONLY_TEAM_ROLES = DOCTOR_TEAM_ROLES.filter((r) => r !== "admission");

/**
 * Legacy-'admission' protection: true only when the row's user does NOT hold
 * "admission" in their admin-set allowlist. Pre-feature 'admission' check-ins
 * could only be opened by allowlisted vets, so any allowlisted user's row is
 * treated as potentially-legacy and left alone. Exported for the unit-test
 * WHERE-clause contract.
 */
export const LEGACY_ADMISSION_ALLOWLIST_GUARD = sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${clinicalCheckIns.userId} AND ${users.clinicId} = ${clinicalCheckIns.clinicId} AND ${users.allowedOperationalRoles} @> '["admission"]'::jsonb)`;

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
        or(
          inArray(clinicalCheckIns.operationalRole, GATE_ONLY_TEAM_ROLES),
          and(
            eq(clinicalCheckIns.operationalRole, "admission"),
            LEGACY_ADMISSION_ALLOWLIST_GUARD,
          ),
        ),
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
