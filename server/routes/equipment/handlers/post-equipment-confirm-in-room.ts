import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment, rooms, scanLogs } from "../../../db.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { recordEquipmentSeen } from "../../../lib/equipment-seen.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/:id/confirm-in-room — assign room + verification scan (passive location loop). */
export const postEquipmentConfirmInRoomHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const equipmentId = req.params.id;
    const { roomId } = req.body as { roomId: string };

    const now = new Date();
    let roomName = "";
    let updatedStatus = "ok";

    await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(rooms)
        .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, roomId)))
        .limit(1);

      if (!room) {
        throw Object.assign(new Error("Room not found"), { status: 404 });
      }
      roomName = room.name;

      const [row] = await tx
        .select()
        .from(equipment)
        .where(
          and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)),
        )
        .limit(1);

      if (!row) {
        throw Object.assign(new Error("Equipment not found"), { status: 404 });
      }

      updatedStatus = row.status;

      const [item] = await tx
        .update(equipment)
        .set({
          roomId,
          location: room.name,
          lastSeen: now,
          lastVerifiedAt: now,
          lastVerifiedById: req.authUser!.id,
          version: sql`${equipment.version} + 1`,
        })
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)))
        .returning({
          id: equipment.id,
          roomId: equipment.roomId,
          location: equipment.location,
          lastSeen: equipment.lastSeen,
          version: equipment.version,
        });

      if (!item) {
        throw Object.assign(new Error("Equipment not found"), { status: 404 });
      }

      await tx.insert(scanLogs).values({
        id: randomUUID(),
        clinicId,
        equipmentId,
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        status: row.status,
        note: `Confirmed in room: ${room.name}`,
        timestamp: now,
      });

      await tx
        .update(rooms)
        .set({ syncStatus: "synced", lastAuditAt: now, updatedAt: now })
        .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, roomId)));
    });

    void recordEquipmentSeen({
      clinicId,
      equipmentId,
      roomId,
    }).catch(() => {});

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_scanned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: equipmentId,
      targetType: "equipment",
      metadata: { roomId, roomName, confirmInRoom: true },
    });

    res.json({
      equipmentId,
      roomId,
      roomName,
      status: updatedStatus,
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { status?: number }).status === 404) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "NOT_FOUND",
          message: err.message,
          requestId,
        }),
      );
    }
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONFIRM_IN_ROOM_FAILED",
        message: "Could not confirm equipment in room",
        requestId,
      }),
    );
  }
};
