import type { RequestHandler } from "express";
import { db, equipment } from "../../../db.js";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** GET /api/equipment/critical */
export const getCriticalEquipmentHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const items = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        category: sql<string>`COALESCE(${equipment.model}, 'General')`,
        status: equipment.status,
        lastSeenLocation: sql<string | null>`COALESCE(${equipment.checkedOutLocation}, ${equipment.location})`,
        lastSeenTimestamp: equipment.lastSeen,
      })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          inArray(equipment.status, ["critical", "needs_attention"]),
          isNull(equipment.deletedAt),
        ),
      )
      .orderBy(
        desc(equipment.lastSeen),
        sql`(CASE WHEN COALESCE(TRIM(${equipment.checkedOutLocation}), TRIM(${equipment.location})) IS NOT NULL AND LENGTH(TRIM(COALESCE(${equipment.checkedOutLocation}, ${equipment.location}, ''))) > 0 THEN 0 ELSE 1 END) ASC`,
        sql`(CASE WHEN ${equipment.nfcTagId} IS NOT NULL OR ${equipment.roomId} IS NOT NULL THEN 0 ELSE 1 END) ASC`,
        sql`CASE WHEN ${equipment.status} = 'critical' THEN 0 ELSE 1 END ASC`,
      );

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CRITICAL_EQUIPMENT_FETCH_FAILED",
        message: "Failed to fetch critical equipment",
        requestId,
      }),
    );
  }
};
