import type { RequestHandler } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { containerItems, containers, db, inventoryItems } from "../../../db.js";
import { resolveBlueprintEntryForContainerName } from "../../../config/inventoryBlueprint.js";
import { apiError, resolveRequestId } from "../../../lib/route-utils.js";

// Inventory container list is NON-clinical consumables data — any authenticated
// staff member (student floor) may read it to dispense/restock. Not a clinical gate.
/** GET /api/containers */
export const getContainerListHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const nfcTagId = typeof req.query.nfcTagId === "string" ? req.query.nfcTagId.trim() : null;

    if (nfcTagId) {
      // Lookup by NFC tag — return single container with items or 404
      const [container] = await db
        .select()
        .from(containers)
        .where(and(eq(containers.clinicId, clinicId), eq(containers.nfcTagId, nfcTagId)))
        .limit(1);

      if (!container) {
        return res.status(404).json(
          apiError({ code: "NOT_FOUND", reason: "CONTAINER_NOT_FOUND", message: "No container found for this NFC tag", requestId }),
        );
      }

      const items = await db
        .select({
          id: containerItems.id,
          itemId: containerItems.itemId,
          quantity: containerItems.quantity,
          label: inventoryItems.label,
          code: inventoryItems.code,
        })
        .from(containerItems)
        .leftJoin(inventoryItems, eq(containerItems.itemId, inventoryItems.id))
        .where(and(eq(containerItems.clinicId, clinicId), eq(containerItems.containerId, container.id)));

      return res.json({ ...container, items });
    }

    const rows = await db
      .select()
      .from(containers)
      .where(eq(containers.clinicId, clinicId))
      .orderBy(asc(containers.name));
    const ids = rows.map((row) => row.id);
    const aggregateRows = ids.length
      ? await db
          .select({
            containerId: containerItems.containerId,
            quantity: sql<number>`COALESCE(SUM(${containerItems.quantity}), 0)`,
          })
          .from(containerItems)
          .where(and(eq(containerItems.clinicId, clinicId), inArray(containerItems.containerId, ids)))
          .groupBy(containerItems.containerId)
      : [];
    const qtyByContainerId = new Map(aggregateRows.map((row) => [row.containerId, Number(row.quantity)]));
    const withBlueprintTargets = rows.map((row) => {
      const entry = resolveBlueprintEntryForContainerName(row.name);
      const currentQuantity = qtyByContainerId.get(row.id) ?? row.currentQuantity;
      return {
        ...row,
        currentQuantity,
        supplyTargets: entry?.supplyTargets ?? [],
      };
    });
    res.json(withBlueprintTargets);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINERS_LIST_FAILED",
        message: "Failed to list containers",
        requestId,
      }),
    );
  }
};
