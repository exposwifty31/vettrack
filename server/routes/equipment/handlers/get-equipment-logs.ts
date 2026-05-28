import type { RequestHandler } from "express";
import { db, scanLogs, users } from "../../../db.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

const LOGS_DEFAULT_PAGE_SIZE = 50;
const LOGS_MAX_PAGE_SIZE = 200;

/** GET /api/equipment/:id/logs */
export const getEquipmentLogsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawPage = parseInt(req.query.page as string, 10);
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, LOGS_MAX_PAGE_SIZE) : LOGS_DEFAULT_PAGE_SIZE;
    const page = !isNaN(rawPage) && rawPage > 1 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const rawSince = req.query.since as string | undefined;
    const sinceDate = rawSince ? new Date(rawSince) : null;
    const sinceFilter = sinceDate && !isNaN(sinceDate.getTime()) ? gte(scanLogs.timestamp, sinceDate) : undefined;

    const baseWhere = and(
      eq(scanLogs.clinicId, clinicId),
      eq(scanLogs.equipmentId, req.params.id),
      sinceFilter,
    );

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(scanLogs)
      .where(baseWhere);

    const isAdmin = req.authUser?.role === "admin";

    const rows = await db
      .select({
        id: scanLogs.id,
        clinicId: scanLogs.clinicId,
        equipmentId: scanLogs.equipmentId,
        userId: scanLogs.userId,
        userEmail: scanLogs.userEmail,
        status: scanLogs.status,
        note: scanLogs.note,
        photoUrl: scanLogs.photoUrl,
        timestamp: scanLogs.timestamp,
        staffName: users.name,
        staffRole: users.role,
      })
      .from(scanLogs)
      .leftJoin(users, and(eq(scanLogs.userId, users.id), eq(users.clinicId, clinicId)))
      .where(baseWhere)
      .orderBy(desc(scanLogs.timestamp))
      .limit(limit)
      .offset(offset);

    // Attribution boundary: staff name/role only on admin (audit) surfaces.
    const items = isAdmin ? rows : rows.map(({ staffName: _sn, staffRole: _sr, ...rest }) => rest);

    res.json({ items, total, page, pageSize: limit, hasMore: offset + items.length < total });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_LOGS_FETCH_FAILED",
        message: "Failed to get logs",
        requestId,
      }),
    );
  }
};
