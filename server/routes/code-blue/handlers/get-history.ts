import type { RequestHandler } from "express";
import { db, codeBlueSessions } from "../../../db.js";
import { eq, and, desc } from "drizzle-orm";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

// GET /api/code-blue/history — admin: list ended sessions
export const getHistoryHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const sessions = await db
      .select()
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "ended")))
      .orderBy(desc(codeBlueSessions.startedAt))
      .limit(100);

    res.json(sessions);
  } catch (err) {
    console.error("[code-blue] history list failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "HISTORY_FAILED", message: "Failed to list history", requestId }),
    );
  }
};
