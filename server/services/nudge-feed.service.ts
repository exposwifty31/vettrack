import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, equipment } from "../db.js";
import type { UserRole } from "../middleware/auth.js";
import { listLowStockItems } from "./inventory-console.service.js";

/**
 * Role-scoped nudge feed — compute-on-read (T-30a1-i, T-30a1-ii · R-IN-F1 · small-03).
 *
 * ARCHITECTURE: `expiryCheckWorker` (server/workers/expiryCheckWorker.ts) runs
 * in a separate process from the API, so an in-memory push feed can't bridge
 * them, and a new table is heavier than this feature warrants. This service
 * derives nudges fresh from existing clinicId-scoped rows/services on every
 * read — it is NOT a worker-pushed store. Do not wire expiryCheckWorker to
 * push into this module and do not add a table for it. The restock kind
 * reuses `listLowStockItems` rather than re-deriving its aggregation query.
 */

export type NudgeKind = "expiry" | "restock";

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

/**
 * The role that should see restock nudges — same day-to-day inventory
 * operational floor as the expiry path. Mirrors `requireEffectiveRole("technician")`
 * on server/routes/procurement.ts's view/receive endpoints (the admin-gated
 * `/api/inventory-items/low-stock` console route is a separate oversight
 * consumer of the same underlying restock-needed rule, not this nudge feed).
 */
const RESTOCK_NUDGE_TARGET_ROLE: UserRole = "technician";

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
      // Drizzle infers expiryDate as `string | null` (the column is nullable);
      // the isNotNull() filter above guarantees non-null at runtime but can't
      // narrow the inferred select type, hence the cast.
    ) as Promise<ExpiringEquipmentRow[]>;
}

/**
 * Computes the nudge feed for one clinic + role. Derives "expiry" nudges from
 * `vt_equipment` rows expiring within the worker's threshold, and "restock"
 * nudges by reusing `listLowStockItems` (server/services/inventory-console.service.ts)
 * — the codebase's existing clinicId-scoped restock-needed rule: an item has
 * a par level and its summed on-hand across containers is below it. Each
 * nudge is tagged with the role responsible for acting on it, then only the
 * nudges whose `targetRole` matches the requesting user's role are returned.
 */
export async function computeNudgesForUser(clinicId: string, role: string): Promise<Nudge[]> {
  const [expiringRows, lowStockRows] = await Promise.all([
    fetchExpiringEquipment(clinicId),
    listLowStockItems(clinicId),
  ]);

  const createdAt = new Date().toISOString();

  const expiryNudges: Nudge[] = expiringRows.map((row) => ({
    id: `expiry:${row.id}`,
    kind: "expiry",
    targetRole: EXPIRY_NUDGE_TARGET_ROLE,
    entityId: row.id,
    createdAt,
  }));

  const restockNudges: Nudge[] = lowStockRows.map((row) => ({
    id: `restock:${row.itemId}`,
    kind: "restock",
    targetRole: RESTOCK_NUDGE_TARGET_ROLE,
    entityId: row.itemId,
    createdAt,
  }));

  return [...expiryNudges, ...restockNudges].filter((nudge) => nudge.targetRole === role);
}
