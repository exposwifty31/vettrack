import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, equipment } from "../db.js";
import type { UserRole } from "../middleware/auth.js";

/**
 * Role-scoped nudge feed — compute-on-read (T-30a1-i · R-IN-F1 · small-03).
 *
 * ARCHITECTURE: `expiryCheckWorker` (server/workers/expiryCheckWorker.ts) runs
 * in a separate process from the API, so an in-memory push feed can't bridge
 * them, and a new table is heavier than this feature warrants. This service
 * derives nudges fresh from existing clinicId-scoped rows on every read —
 * it is NOT a worker-pushed store. Do not wire expiryCheckWorker to push
 * into this module and do not add a table for it.
 */

export type NudgeKind = "expiry";

export interface Nudge {
  id: string;
  kind: NudgeKind;
  targetRole: UserRole;
  entityId: string;
  message?: string;
  createdAt: string;
}

/**
 * The role that should see expiry nudges — the inventory/procurement
 * operational floor. Mirrors `requireEffectiveRole("technician")` on
 * server/routes/procurement.ts's view/receive endpoints, the existing gate
 * for day-to-day inventory management duties.
 */
const EXPIRY_NUDGE_TARGET_ROLE: UserRole = "technician";

type ExpiringEquipmentRow = {
  id: string;
  name: string;
  expiryDate: string;
};

/**
 * Same clinicId-scoped 7-day lookahead window as
 * `fetchExpiringEquipmentForClinic` in server/workers/expiryCheckWorker.ts.
 * Deliberately does not filter on `expiryNotifiedAt` — that column dedupes
 * the worker's push notifications and has no bearing on this always-fresh
 * read-time feed.
 */
async function fetchExpiringEquipment(clinicId: string): Promise<ExpiringEquipmentRow[]> {
  return db
    .select({
      id: equipment.id,
      name: equipment.name,
      expiryDate: equipment.expiryDate,
    })
    .from(equipment)
    .where(
      and(
        eq(equipment.clinicId, clinicId),
        isNull(equipment.deletedAt),
        isNotNull(equipment.expiryDate),
        lte(equipment.expiryDate, sql`(CURRENT_DATE + INTERVAL '7 days')::date`),
      ),
    ) as Promise<ExpiringEquipmentRow[]>;
}

/**
 * Computes the nudge feed for one clinic + role. Derives "expiry" nudges from
 * `vt_equipment` rows expiring within the worker's threshold, tags each with
 * the role responsible for acting on it, then returns only the nudges whose
 * `targetRole` matches the requesting user's role.
 */
export async function computeNudgesForUser(clinicId: string, role: string): Promise<Nudge[]> {
  const rows = await fetchExpiringEquipment(clinicId);
  const nudges: Nudge[] = rows.map((row) => ({
    id: `expiry:${row.id}`,
    kind: "expiry",
    targetRole: EXPIRY_NUDGE_TARGET_ROLE,
    entityId: row.id,
    createdAt: new Date().toISOString(),
  }));
  return nudges.filter((nudge) => nudge.targetRole === role);
}
