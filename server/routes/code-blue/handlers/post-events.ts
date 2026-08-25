import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, codeBlueEvents } from "../../../db.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

// POST /api/code-blue/events — start a Code Blue event (fire-and-forget safe).
// Legacy archive write; the clinical-gate rationale lives with the middleware
// chain in server/routes/code-blue.ts, next to this route's registration.
export const postEventsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;

    const id = randomUUID();
    const startedAt = new Date();

    await db.insert(codeBlueEvents).values({
      id,
      clinicId,
      startedByUserId: userId,
      startedAt,
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_started",
      performedBy: userId,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "code_blue_event",
      metadata: { startedAt: startedAt.toISOString() },
    });

    res.status(201).json({ id, startedAt: startedAt.toISOString() });
  } catch (err) {
    console.error("[code-blue] start failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "CODE_BLUE_START_FAILED", message: "Failed to start Code Blue event", requestId }),
    );
  }
};
