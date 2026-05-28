import type { RequestHandler } from "express";
import { db, equipment } from "../../../db.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/:id/restore — admin only, restore a soft-deleted equipment record */
export const postEquipmentRestoreHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNotNull(equipment.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND_OR_NOT_DELETED",
          message: "Equipment not found or not deleted",
          requestId,
        }),
      );
    }

    const [restored] = await db
      .update(equipment)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
      .returning();

    if (restored) {
      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "equipment_restored",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        targetId: req.params.id,
        targetType: "equipment",
        metadata: { equipmentName: restored.name },
      });
    }

    invalidateAnalyticsCache(clinicId);
    res.json(restored);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_RESTORE_FAILED",
        message: "Failed to restore equipment",
        requestId,
      }),
    );
  }
};
