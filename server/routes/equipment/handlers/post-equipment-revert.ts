import type { RequestHandler } from "express";
import { db, equipment, scanLogs } from "../../../db.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { consumeUndoToken } from "../equipment-undo-tokens.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

type EquipmentRow = typeof equipment.$inferSelect;

/** POST /api/equipment/:id/revert */
export const postEquipmentRevertHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { undoToken: tokenId } = req.body as { undoToken: string };

    const [existingItem] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const token = await consumeUndoToken(clinicId, tokenId, req.params.id, req.authUser!.id);
    if (!token) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "UNDO_TOKEN_INVALID_OR_EXPIRED",
          message: "Undo window expired or token invalid",
          requestId,
        }),
      );
    }

    const prev = token.previousState;

    let updated: EquipmentRow | null = null;
    let versionConflict = false;

    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(equipment)
        .set({
          status: prev.status,
          lastSeen: prev.lastSeen ? new Date(prev.lastSeen) : null,
          lastStatus: prev.lastStatus,
          lastMaintenanceDate: prev.lastMaintenanceDate ? new Date(prev.lastMaintenanceDate) : null,
          lastSterilizationDate: prev.lastSterilizationDate ? new Date(prev.lastSterilizationDate) : null,
          checkedOutById: prev.checkedOutById,
          checkedOutByEmail: prev.checkedOutByEmail,
          checkedOutAt: prev.checkedOutAt ? new Date(prev.checkedOutAt) : null,
          checkedOutLocation: prev.checkedOutLocation,
          version: sql`${equipment.version} + 1`,
        })
        .where(
          and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, req.params.id),
            eq(equipment.version, existingItem.version),
          ),
        )
        .returning();

      if (!result) {
        versionConflict = true;
        return;
      }

      updated = result;

      await tx
        .delete(scanLogs)
        .where(and(eq(scanLogs.clinicId, clinicId), eq(scanLogs.id, token.scanLogId), eq(scanLogs.equipmentId, req.params.id)));
    });

    if (versionConflict) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_VERSION_CONFLICT",
          message: "Equipment was modified by someone else — reload and retry",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_reverted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: (updated as EquipmentRow | null)?.name ?? null },
    });

    invalidateAnalyticsCache(clinicId);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_REVERT_FAILED",
        message: "Revert failed",
        requestId,
      }),
    );
  }
};
