import type { RequestHandler } from "express";
import { db, equipment } from "../../../db.js";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** GET /api/equipment/deleted — admin only, list soft-deleted equipment */
export const getDeletedEquipmentHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const items = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        model: equipment.model,
        manufacturer: equipment.manufacturer,
        status: equipment.status,
        deletedAt: equipment.deletedAt,
        deletedBy: equipment.deletedBy,
        createdAt: equipment.createdAt,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.deletedAt)))
      .orderBy(desc(equipment.deletedAt));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "DELETED_EQUIPMENT_LIST_FAILED",
        message: "Failed to list deleted equipment",
        requestId,
      }),
    );
  }
};
