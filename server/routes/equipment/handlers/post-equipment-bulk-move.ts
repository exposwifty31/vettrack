import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment, folders, transferLogs } from "../../../db.js";
import { and, eq, isNull } from "drizzle-orm";
import { sendPushToAll } from "../../../lib/push.js";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/bulk-move */
export const postEquipmentBulkMoveHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { ids: typedIds, folderId } = req.body as { ids: string[]; folderId?: string | null };
    const targetFolderId = folderId ?? null;

    let targetFolderName: string | null = null;

    await db.transaction(async (tx) => {
      const [targetFolder] = targetFolderId
        ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, targetFolderId))).limit(1)
        : [null];
      targetFolderName = targetFolder?.name ?? null;
      const moveNote = `Bulk moved to ${targetFolderName ?? "Unassigned"} (${typedIds.length} item${typedIds.length !== 1 ? "s" : ""})`;

      for (const id of typedIds) {
        const [item] = await tx
          .select()
          .from(equipment)
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id), isNull(equipment.deletedAt)))
          .limit(1);
        if (!item) continue;

        const [oldFolder] = item.folderId
          ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, item.folderId))).limit(1)
          : [null];

        await tx
          .update(equipment)
          .set({ folderId: targetFolderId })
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id)));

        await tx.insert(transferLogs).values({
          id: randomUUID(),
          clinicId,
          equipmentId: id,
          fromFolderId: item.folderId ?? null,
          fromFolderName: oldFolder?.name ?? null,
          toFolderId: targetFolderId,
          toFolderName: targetFolder?.name ?? null,
          userId: req.authUser!.id,
          note: moveNote,
        });
      }
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_bulk_moved",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: targetFolderId,
      targetType: "folder",
      metadata: { ids: typedIds, count: typedIds.length, targetFolderName },
    });

    invalidateAnalyticsCache(clinicId);
    res.json({ affected: typedIds.length });

    const toLabel = targetFolderName ?? "Unassigned";
    sendPushToAll(clinicId, {
      title: "Bulk Transfer",
      body: `${typedIds.length} item${typedIds.length !== 1 ? "s" : ""} moved to ${toLabel}`,
      tag: `bulk-move:${Date.now()}`,
      url: "/",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_BULK_MOVE_FAILED",
        message: "Bulk move failed",
        requestId,
      }),
    );
  }
};
