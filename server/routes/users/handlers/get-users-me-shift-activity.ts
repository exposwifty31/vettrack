import type { RequestHandler } from "express";
import { db, shiftSessions } from "../../../db.js";
import { eq, and, desc } from "drizzle-orm";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** GET /api/users/me/shift-activity */
export const getUsersMeShiftActivityHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const sessions = await db
      .select({
        id: shiftSessions.id,
        startedAt: shiftSessions.startedAt,
        endedAt: shiftSessions.endedAt,
        note: shiftSessions.note,
      })
      .from(shiftSessions)
      .where(and(
        eq(shiftSessions.clinicId, clinicId),
        eq(shiftSessions.startedByUserId, userId),
      ))
      .orderBy(desc(shiftSessions.startedAt))
      .limit(20);
    res.json(sessions);
  } catch (err) {
    console.error("[users:me:shift-activity] failed", err);
    res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "SHIFT_ACTIVITY_FETCH_FAILED",
      message: "Failed to get shift activity",
      requestId,
    }));
  }
};
