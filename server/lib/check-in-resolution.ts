/**
 * Phase 2.5 PR 3: Open clinical check-in lookup.
 *
 * Read-only helper for resolveAuthority(). Returns the single open
 * vt_clinical_check_ins row for a (clinicId, userId) pair, or null. The
 * uniqueness invariant is enforced at the DB level by the partial unique
 * index ux_vt_clinical_check_ins_open_per_user; limit(1) here is defensive.
 *
 * This module is intentionally separate from server/lib/authority.ts so its
 * DB error surface stays isolated from the legacy shift resolver — the caller
 * decides how a check-in lookup failure maps to an authority outcome.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { clinicalCheckIns, db } from "../db.js";

export interface OpenClinicalCheckInRow {
  id: string;
  clinicId: string;
  userId: string;
  clinicalRoleAtCheckIn: string;
  operationalRole: string | null;
  checkedInAt: Date;
}

export interface GetOpenClinicalCheckInInput {
  clinicId: string;
  userId: string;
}

export async function getOpenClinicalCheckIn(
  input: GetOpenClinicalCheckInInput,
): Promise<OpenClinicalCheckInRow | null> {
  const rows = await db
    .select({
      id: clinicalCheckIns.id,
      clinicId: clinicalCheckIns.clinicId,
      userId: clinicalCheckIns.userId,
      clinicalRoleAtCheckIn: clinicalCheckIns.clinicalRoleAtCheckIn,
      operationalRole: clinicalCheckIns.operationalRole,
      checkedInAt: clinicalCheckIns.checkedInAt,
    })
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, input.clinicId),
        eq(clinicalCheckIns.userId, input.userId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .orderBy(desc(clinicalCheckIns.checkedInAt))
    .limit(1);

  return rows[0] ?? null;
}
