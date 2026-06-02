import { and, eq } from "drizzle-orm";
import { inventoryItems } from "../db.js";
import type { AuditDbExecutor } from "./audit.js";

export type OrphanReasonCode =
  | "NO_ACTIVE_ORDER"
  | "QUANTITY_EXCEEDS_ORDER";

export type OrphanLineDetail = {
  itemId: string;
  quantity: number;
  label: string;
  reasons: OrphanReasonCode[];
  matchingOrderIds: string[];
};

export type DispenseLineForValidation = {
  itemId: string;
  quantity: number;
  label: string;
  code: string;
};

/**
 * Cross-check cabinet dispense lines against active medication appointments.
 * Medication appointment tasks are disabled; no orphan enforcement from appointments.
 */
export async function evaluateDispenseAgainstOrders(
  _tx: AuditDbExecutor,
  _params: {
    clinicId: string;
    containerId: string;
    lines: DispenseLineForValidation[];
  },
): Promise<{ orphanLines: OrphanLineDetail[] }> {
  return { orphanLines: [] };
}

/** Load inventory item label + code for validation within an existing transaction. */
export async function loadInventoryItemLabelCode(
  tx: AuditDbExecutor,
  clinicId: string,
  itemId: string,
): Promise<{ label: string; code: string } | null> {
  const [row] = await tx
    .select({ label: inventoryItems.label, code: inventoryItems.code })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, itemId)))
    .limit(1);
  if (!row) return null;
  return { label: row.label ?? "", code: row.code ?? "" };
}
