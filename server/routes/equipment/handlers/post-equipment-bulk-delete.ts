import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment, equipmentWaitlist, scanLogs, stagingQueue } from "../../../db.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/bulk-delete */
export const postEquipmentBulkDeleteHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { ids: typedIds } = req.body as { ids: string[] };
    const actorName = req.authUser!.name || req.authUser!.email;

    await db.transaction(async (tx) => {
      const items = await tx
        .select({ id: equipment.id, name: equipment.name, status: equipment.status })
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, typedIds), isNull(equipment.deletedAt)));

      const now = new Date();
      if (items.length > 0) {
        await tx.insert(scanLogs).values(
          items.map((item) => ({
            id: randomUUID(),
            clinicId,
            equipmentId: item.id,
            userId: req.authUser!.id,
            userEmail: req.authUser!.email,
            status: item.status,
            note: `Bulk deleted by ${actorName}`,
            timestamp: now,
          })),
        );

        const deletedIds = items.map((i) => i.id);

        await tx
          .update(equipment)
          .set({ deletedAt: now, deletedBy: req.authUser!.id })
          .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, deletedIds)));

        await tx
          .update(equipmentWaitlist)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(
            and(
              eq(equipmentWaitlist.clinicId, clinicId),
              inArray(equipmentWaitlist.equipmentId, deletedIds),
              inArray(equipmentWaitlist.status, ["waiting", "notified"]),
            ),
          );

        await tx
          .update(stagingQueue)
          .set({ status: "cancelled", updatedAt: now })
          .where(
            and(
              eq(stagingQueue.clinicId, clinicId),
              inArray(stagingQueue.equipmentId, deletedIds),
              eq(stagingQueue.status, "active"),
            ),
          );

        // Reset staged usage so a later restore is checkout-usable (no active claims + usageState=staged).
        await tx
          .update(equipment)
          .set({
            usageState: "available",
            usageStateSince: now,
            version: sql`${equipment.version} + 1`,
          })
          .where(
            and(
              eq(equipment.clinicId, clinicId),
              inArray(equipment.id, deletedIds),
              eq(equipment.usageState, "staged"),
            ),
          );
      }

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "equipment_bulk_deleted",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: null,
        targetType: "equipment",
        metadata: { ids: typedIds, count: typedIds.length },
      });
    });

    invalidateAnalyticsCache(clinicId);
    res.json({ affected: typedIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_BULK_DELETE_FAILED",
        message: "Bulk delete failed",
        requestId,
      }),
    );
  }
};
