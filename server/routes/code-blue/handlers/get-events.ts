import type { RequestHandler } from "express";
import { db, codeBlueEvents } from "../../../db.js";
import { eq, desc } from "drizzle-orm";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

// GET /api/code-blue/events  — admin: list recent events for this clinic
export const getEventsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const items = await db
      .select()
      .from(codeBlueEvents)
      .where(eq(codeBlueEvents.clinicId, clinicId))
      .orderBy(desc(codeBlueEvents.startedAt))
      .limit(50);

    res.json(items);
  } catch (err) {
    console.error("[code-blue] list failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "CODE_BLUE_LIST_FAILED", message: "Failed to list Code Blue events", requestId }),
    );
  }
};
