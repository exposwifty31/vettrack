import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment, folders, transferLogs } from "../../../db.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { checkDedupe, sendPushToAll, shouldSendPilotEnglishEquipmentPush } from "../../../lib/push.js";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

type EquipmentRow = typeof equipment.$inferSelect;

/** PATCH /api/equipment/:id */
export const patchEquipmentHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const {
      name,
      nameHe,
      serialNumber,
      model,
      manufacturer,
      purchaseDate,
      expiryDate,
      location,
      folderId,
      roomId,
      nfcTagId,
      rfidTagEpc,
      maintenanceIntervalDays,
      expectedReturnMinutes,
      imageUrl,
      usuallyFoundHere,
      searchAlias,
      staffNote,
      status,
      version: expectedVersion,
    } = req.body as {
      name?: string;
      nameHe?: string | null;
      serialNumber?: string;
      model?: string;
      manufacturer?: string;
      purchaseDate?: string | null;
      expiryDate?: string | null;
      location?: string;
      folderId?: string | null;
      roomId?: string | null;
      nfcTagId?: string | null;
      rfidTagEpc?: string | null;
      maintenanceIntervalDays?: number | null;
      expectedReturnMinutes?: number | null;
      imageUrl?: string | null;
      usuallyFoundHere?: string | null;
      searchAlias?: string | null;
      staffNote?: string | null;
      status?: string;
      version?: number;
    };

    if (expectedReturnMinutes !== undefined && req.authUser?.role !== "admin") {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "EXPECTED_RETURN_MINUTES_ADMIN_ONLY",
          message: "Only admins can set expected return minutes",
          requestId,
        }),
      );
    }

    let result: EquipmentRow | null = null;
    let versionConflict = false;

    await db.transaction(async (tx) => {
      const [oldItem] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!oldItem) return;

      if (expectedVersion !== undefined && oldItem.version !== expectedVersion) {
        versionConflict = true;
        return;
      }

      const [item] = await tx
        .update(equipment)
        .set({
          ...(name !== undefined && { name }),
          ...(nameHe !== undefined && { nameHe: nameHe?.trim() || null }),
          ...(serialNumber !== undefined && { serialNumber }),
          ...(model !== undefined && { model }),
          ...(manufacturer !== undefined && { manufacturer }),
          ...(purchaseDate !== undefined && { purchaseDate }),
          ...(expiryDate !== undefined && { expiryDate, expiryNotifiedAt: null }),
          ...(location !== undefined && { location }),
          ...(folderId !== undefined && { folderId: folderId ?? null }),
          ...(roomId !== undefined && { roomId: roomId ?? null }),
          ...(nfcTagId !== undefined && { nfcTagId: nfcTagId ?? null }),
          ...(rfidTagEpc !== undefined && { rfidTagEpc: rfidTagEpc?.trim() || null }),
          ...(maintenanceIntervalDays !== undefined && { maintenanceIntervalDays }),
          ...(expectedReturnMinutes !== undefined && { expectedReturnMinutes }),
          ...(imageUrl !== undefined && { imageUrl }),
          ...(usuallyFoundHere !== undefined && { usuallyFoundHere }),
          ...(searchAlias !== undefined && { searchAlias }),
          ...(staffNote !== undefined && { staffNote }),
          ...(status !== undefined && { status }),
          version: sql`${equipment.version} + 1`,
        })
        .where(
          and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, req.params.id),
            isNull(equipment.deletedAt),
            ...(expectedVersion !== undefined ? [eq(equipment.version, expectedVersion)] : []),
          ),
        )
        .returning();

      if (!item) {
        versionConflict = expectedVersion !== undefined;
        return;
      }
      result = item;

      if (folderId !== undefined && oldItem && oldItem.folderId !== (folderId ?? null)) {
        const [oldFolder] = oldItem.folderId
          ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, oldItem.folderId))).limit(1)
          : [null];
        const targetFolderId = folderId ?? null;
        const [newFolder] = targetFolderId
          ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, targetFolderId))).limit(1)
          : [null];
        await tx.insert(transferLogs).values({
          id: randomUUID(),
          clinicId,
          equipmentId: req.params.id,
          fromFolderId: oldItem.folderId ?? null,
          fromFolderName: oldFolder?.name ?? null,
          toFolderId: targetFolderId,
          toFolderName: newFolder?.name ?? null,
          userId: req.authUser!.id,
        });

        const itemName = result?.name ?? oldItem.name;
        if (shouldSendPilotEnglishEquipmentPush() && !checkDedupe(req.params.id, "transfer")) {
          const toLabel = newFolder?.name ?? "unassigned";
          sendPushToAll(clinicId, {
            title: "Equipment Transferred",
            body: `${itemName} moved to ${toLabel}`,
            tag: `transfer:${req.params.id}`,
            url: `/equipment/${req.params.id}`,
          });
        }
      }
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

    if (!result) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: (result as EquipmentRow).name, changes: req.body },
    });

    invalidateAnalyticsCache(clinicId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_UPDATE_FAILED",
        message: "Failed to update equipment",
        requestId,
      }),
    );
  }
};
