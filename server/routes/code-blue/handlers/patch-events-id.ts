import type { RequestHandler } from "express";
import { z } from "zod";
import { db, codeBlueEvents } from "../../../db.js";
import { eq, and } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import type { endSchema } from "../schemas.js";

// PATCH /api/code-blue/events/:id — close a Code Blue event with outcome + timeline.
// Legacy archive write; the clinical-gate rationale (same posture as POST
// /events) lives with the middleware chain in server/routes/code-blue.ts,
// next to this route's registration.
export const patchEventsIdHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;
    const body = req.body as z.infer<typeof endSchema>;

    const [updated] = await db
      .update(codeBlueEvents)
      .set({
        endedAt: new Date(),
        ...(body.outcome ? { outcome: body.outcome } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.timeline ? { timeline: body.timeline } : {}),
      })
      .where(and(eq(codeBlueEvents.id, id), eq(codeBlueEvents.clinicId, clinicId)))
      .returning({ id: codeBlueEvents.id, endedAt: codeBlueEvents.endedAt });

    if (!updated) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "EVENT_NOT_FOUND", message: "Code Blue event not found", requestId }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_ended",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "code_blue_event",
      metadata: { outcome: body.outcome ?? null, endedAt: updated.endedAt?.toISOString() },
    });

    res.json({ id: updated.id, endedAt: updated.endedAt });
  } catch (err) {
    console.error("[code-blue] end failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "CODE_BLUE_END_FAILED", message: "Failed to end Code Blue event", requestId }),
    );
  }
};
