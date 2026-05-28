import type { RequestHandler } from "express";
import { db, transferLogs } from "../../../db.js";
import { and, desc, eq } from "drizzle-orm";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** GET /api/equipment/:id/transfers */
export const getEquipmentTransfersHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const transfers = await db
      .select()
      .from(transferLogs)
      .where(and(eq(transferLogs.clinicId, clinicId), eq(transferLogs.equipmentId, req.params.id)))
      .orderBy(desc(transferLogs.timestamp));
    res.json(transfers);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_TRANSFERS_FETCH_FAILED",
        message: "Failed to get transfers",
        requestId,
      }),
    );
  }
};
