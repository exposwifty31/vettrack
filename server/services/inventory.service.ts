import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { containerItems, containers, db, inventoryItems, inventoryLogs } from "../db.js";
import {
  consumedFromBlueprint,
  INVENTORY_BLUEPRINT,
  INVENTORY_BLUEPRINT_LEGACY_NAMES,
  resolveBlueprintEntryForContainerName,
  targetQuantityFromSupplies,
} from "../config/inventoryBlueprint.js";
import { RestockServiceError } from "./restock.service.js";
import {
  isCheckViolation,
  toInventoryConstraintError,
} from "../lib/db-constraint-errors.js";

/**
 * Aligns persisted `vt_containers.target_quantity` with the current blueprint for that
 * container name (including legacy "ICU Cart *" names). Ensures {@link restockContainerInTx}
 * shortfall math (`consumedFromBlueprint(targetQuantity, currentQuantity)`) reflects the
 * updated high-capacity catheter and monitor sticker targets.
 */
export async function syncContainerTargetQuantitiesFromBlueprint(): Promise<number> {
  let updated = 0;
  const rows = await db.select().from(containers);
  for (const row of rows) {
    const entry = resolveBlueprintEntryForContainerName(row.name);
    if (!entry) continue;
    const target = targetQuantityFromSupplies(entry.supplyTargets);
    const needsLegacyRename = Boolean(INVENTORY_BLUEPRINT_LEGACY_NAMES[row.name]);
    if (row.targetQuantity === target && !needsLegacyRename) continue;

    await db
      .update(containers)
      .set({
        targetQuantity: target,
        ...(needsLegacyRename ? { name: entry.name, department: entry.department } : {}),
      })
      .where(and(eq(containers.clinicId, row.clinicId), eq(containers.id, row.id)));
    updated++;
  }
  return updated;
}

export async function seedContainersFromBlueprint(clinicId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(containers)
    .where(eq(containers.clinicId, clinicId));
  if (n > 0) return 0;

  try {
    await db.insert(containers).values(
      INVENTORY_BLUEPRINT.map((entry) => ({
        id: randomUUID(),
        clinicId,
        name: entry.name,
        department: entry.department,
        targetQuantity: targetQuantityFromSupplies(entry.supplyTargets),
        currentQuantity: targetQuantityFromSupplies(entry.supplyTargets),
      })),
    );
  } catch (err) {
    if (isCheckViolation(err)) {
      throw toInventoryConstraintError(err);
    }
    throw err;
  }
  return INVENTORY_BLUEPRINT.length;
}

export interface RestockContainerParams {
  clinicId: string;
  containerId: string;
  addedQuantity: number;
  actorUserId: string;
}

type RestockContainerResult =
  | { error: "NOT_FOUND" }
  | {
      ok: true;
      container: typeof containers.$inferSelect;
      consumed: number;
    }
;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbTx = any;

/**
 * Restock flow uses the container row's aggregate `targetQuantity` (sum of blueprint
 * supplyTargets at seed/sync time). Shortfall units billed as consumables:
 * `consumed = max(0, targetQuantity - quantityBefore)` — see `consumedFromBlueprint`.
 */
export async function restockContainerInTx(
  tx: DbTx,
  params: RestockContainerParams,
  now = new Date(),
): Promise<RestockContainerResult> {
  const [c] = await tx
    .select()
    .from(containers)
    .where(and(eq(containers.clinicId, params.clinicId), eq(containers.id, params.containerId)))
    .limit(1);
  if (!c) return { error: "NOT_FOUND" as const };

  const quantityBefore = c.currentQuantity;
  const consumed = consumedFromBlueprint(c.targetQuantity, quantityBefore);
  const quantityAfter = Math.min(c.targetQuantity, quantityBefore + params.addedQuantity);

  try {
    await tx
      .update(containers)
      .set({ currentQuantity: quantityAfter })
      .where(and(eq(containers.clinicId, params.clinicId), eq(containers.id, c.id)));
  } catch (err) {
    if (isCheckViolation(err)) {
      throw toInventoryConstraintError(err);
    }
    throw err;
  }

  await tx.insert(inventoryLogs).values({
    id: randomUUID(),
    clinicId: params.clinicId,
    containerId: c.id,
    logType: "restock",
    quantityBefore,
    quantityAdded: params.addedQuantity,
    quantityAfter,
    consumedDerived: consumed,
    variance: null,
    roomId: c.roomId,
    note: null,
    createdByUserId: params.actorUserId,
  });

  return {
    ok: true as const,
    container: { ...c, currentQuantity: quantityAfter },
    consumed,
  };
}

export async function restockContainer(params: RestockContainerParams): Promise<RestockContainerResult> {
  const now = new Date();
  return db.transaction(async (tx) => restockContainerInTx(tx, params, now));
}

/**
 * Resolves inventory item identity from NFC tag id.
 * Used by restock/NFC flows that must map through vt_items canonical identity.
 */
export async function resolveItemByNFCTag(params: { clinicId: string; nfcTagId: string }) {
  const normalizedTag = params.nfcTagId.trim();
  if (!normalizedTag) {
    throw new RestockServiceError("NFC_TAG_REQUIRED", 400, "nfcTagId is required");
  }
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.clinicId, params.clinicId), eq(inventoryItems.nfcTagId, normalizedTag)))
    .limit(1);
  if (!item) {
    throw new RestockServiceError("ITEM_NOT_FOUND", 404, "No item found for this NFC tag");
  }
  return item;
}

/**
 * Aggregates container quantity from vt_container_items (single source of truth).
 */
export async function getContainerQuantityFromItems(params: { clinicId: string; containerId: string }): Promise<number> {
  const rows = await db
    .select({
      qty: sql<number>`COALESCE(SUM(${containerItems.quantity}), 0)`,
    })
    .from(containerItems)
    .where(and(eq(containerItems.clinicId, params.clinicId), eq(containerItems.containerId, params.containerId)));
  return Number(rows[0]?.qty ?? 0);
}
