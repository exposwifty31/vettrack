import type { RequestHandler } from "express";
import { db, equipment, folders, scanLogs } from "../../../db.js";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getPilotStaleMs } from "../../../lib/pilot-config.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** GET /api/equipment/pilot-coverage */
export const getPilotCoverageHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    const rows = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        location: equipment.location,
        usuallyFoundHere: equipment.usuallyFoundHere,
        folderName: folders.name,
        lastSeen: equipment.lastSeen,
        confirmCount: sql<number>`count(${scanLogs.id})::int`,
      })
      .from(equipment)
      .leftJoin(folders, eq(equipment.folderId, folders.id))
      .leftJoin(
        scanLogs,
        and(eq(scanLogs.equipmentId, equipment.id), eq(scanLogs.clinicId, clinicId)),
      )
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)))
      .groupBy(equipment.id, folders.name)
      .orderBy(sql`${equipment.lastSeen} ASC NULLS FIRST`, asc(equipment.name));

    const now = Date.now();
    const staleMs = await getPilotStaleMs();
    const summary = {
      total: rows.length,
      everConfirmed: rows.filter((r) => r.lastSeen != null).length,
      confirmedToday: rows.filter(
        (r) => r.lastSeen != null && now - new Date(r.lastSeen as Date).getTime() <= staleMs,
      ).length,
      neverConfirmed: rows.filter((r) => r.lastSeen == null).length,
    };

    res.json({ summary, items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PILOT_COVERAGE_FETCH_FAILED",
        message: "Failed to fetch pilot coverage",
        requestId,
      }),
    );
  }
};
