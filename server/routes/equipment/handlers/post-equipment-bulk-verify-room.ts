import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment, rooms, scanLogs } from "../../../db.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/bulk-verify-room */
export const postEquipmentBulkVerifyRoomHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { roomId: targetRoomId } = req.body as { roomId: string };

    let affected = 0;
    let roomName = "";

    await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, targetRoomId)))
        .limit(1);

      if (!room) {
        throw Object.assign(new Error("Room not found"), { status: 404 });
      }
      roomName = room.name;

      const items = await tx
        .select({ id: equipment.id, name: equipment.name, status: equipment.status })
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.roomId, targetRoomId), isNull(equipment.deletedAt)));

      if (items.length === 0) {
        await tx
          .update(rooms)
          .set({ syncStatus: "synced", lastAuditAt: new Date(), updatedAt: new Date() })
          .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, targetRoomId)));
        return;
      }

      const now = new Date();
      const itemIds = items.map((i) => i.id);

      await tx
        .update(equipment)
        .set({
          lastVerifiedAt: now,
          lastVerifiedById: req.authUser!.id,
          lastSeen: now,
        })
        .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, itemIds)));

      await tx.insert(scanLogs).values(
        items.map((item) => ({
          id: randomUUID(),
          clinicId,
          equipmentId: item.id,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status: item.status,
          note: `Room verified: ${room.name}`,
          timestamp: now,
        })),
      );

      await tx
        .update(rooms)
        .set({ syncStatus: "synced", lastAuditAt: now, updatedAt: now })
        .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, targetRoomId)));

      affected = items.length;
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "room_bulk_verified",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: targetRoomId,
      targetType: "room",
      metadata: { roomName, count: affected },
    });

    res.json({ affected, roomName });
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { status?: number }).status === 404) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "ROOM_NOT_FOUND",
          message: "Room not found",
          requestId,
        }),
      );
    }
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_BULK_VERIFY_FAILED",
        message: "Bulk verify failed",
        requestId,
      }),
    );
  }
};
