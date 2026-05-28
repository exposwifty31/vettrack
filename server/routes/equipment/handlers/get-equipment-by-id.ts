import type { RequestHandler } from "express";
import { db, equipment, folders, rooms, users } from "../../../db.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";
import { equipmentOperationalStateSelect } from "../equipment-operational-select.js";
import { equipmentRfidSelect } from "../equipment-rfid-select.js";

/** GET /api/equipment/:id */
export const getEquipmentByIdHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [item] = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        model: equipment.model,
        manufacturer: equipment.manufacturer,
        purchaseDate: equipment.purchaseDate,
        expiryDate: equipment.expiryDate,
        expiryNotifiedAt: equipment.expiryNotifiedAt,
        location: equipment.location,
        folderId: equipment.folderId,
        folderName: folders.name,
        roomId: equipment.roomId,
        roomName: rooms.name,
        nfcTagId: equipment.nfcTagId,
        lastVerifiedAt: equipment.lastVerifiedAt,
        lastVerifiedById: equipment.lastVerifiedById,
        lastVerifiedByName: users.name,
        status: equipment.status,
        lastSeen: equipment.lastSeen,
        lastStatus: equipment.lastStatus,
        lastMaintenanceDate: equipment.lastMaintenanceDate,
        lastSterilizationDate: equipment.lastSterilizationDate,
        maintenanceIntervalDays: equipment.maintenanceIntervalDays,
        imageUrl: equipment.imageUrl,
        checkedOutById: equipment.checkedOutById,
        checkedOutByEmail: equipment.checkedOutByEmail,
        checkedOutAt: equipment.checkedOutAt,
        checkedOutLocation: equipment.checkedOutLocation,
        expectedReturnMinutes: equipment.expectedReturnMinutes,
        createdAt: equipment.createdAt,
        usuallyFoundHere: equipment.usuallyFoundHere,
        searchAlias: equipment.searchAlias,
        staffNote: equipment.staffNote,
        linkedAnimalId: sql<string | null>`(
          SELECT a.id
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalId"),
        linkedAnimalName: sql<string | null>`(
          SELECT a.name
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalName"),
        ...equipmentOperationalStateSelect,
        ...equipmentRfidSelect(clinicId),
      })
      .from(equipment)
      .leftJoin(folders, and(eq(equipment.folderId, folders.id), eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
      .leftJoin(users, and(eq(equipment.lastVerifiedById, users.id), eq(users.clinicId, clinicId)))
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);
    if (!item) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_FETCH_FAILED",
        message: "Failed to get equipment",
        requestId,
      }),
    );
  }
};
