import type { RequestHandler } from "express";
import { db, equipment } from "../../../db.js";
import { and, eq, isNull } from "drizzle-orm";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** DELETE /api/equipment/:id — admin soft-delete */
export const deleteEquipmentHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    await db
      .update(equipment)
      .set({ deletedAt: new Date(), deletedBy: req.authUser!.id })
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_deleted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: existing.name, serialNumber: existing.serialNumber },
    });
    invalidateAnalyticsCache(clinicId);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_DELETE_FAILED",
        message: "Failed to delete equipment",
        requestId,
      }),
    );
  }
};
