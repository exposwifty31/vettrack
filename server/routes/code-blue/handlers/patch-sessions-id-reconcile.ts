import type { RequestHandler } from "express";
import type { z } from "zod";
import { db, codeBlueSessions } from "../../../db.js";
import { eq, and } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import type { reconcileSchema } from "../schemas.js";

/**
 * PATCH /api/code-blue/sessions/:id/reconcile
 * Marks a Code Blue session reconciled. Requires ?force=true + body.forceReason
 * (no gap check is computed — force is unconditional, not an override of a
 * validated gap). Admin only. A no-op success if already reconciled.
 */
export const patchSessionsIdReconcileHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const sessionId = req.params.id;
    const force = req.query.force === "true";
    const { forceReason } = req.body as z.infer<typeof reconcileSchema>;

    if (force && !forceReason?.trim()) {
      return res.status(400).json(apiError({ code: "FORCE_REASON_REQUIRED", reason: "FORCE_REASON_REQUIRED", message: "forceReason is required when force=true", requestId }));
    }

    const [session] = await db
      .select({ startedAt: codeBlueSessions.startedAt, endedAt: codeBlueSessions.endedAt, isReconciled: codeBlueSessions.isReconciled })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);

    if (!session) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }));
    if (session.isReconciled) return res.json({ id: sessionId, isReconciled: true, alreadyReconciled: true });

    const [updated] = await db
      .update(codeBlueSessions)
      .set({ isReconciled: true, reconciledAt: new Date(), reconciledByUserId: req.authUser!.id })
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .returning({ id: codeBlueSessions.id, isReconciled: codeBlueSessions.isReconciled, reconciledAt: codeBlueSessions.reconciledAt });

    if (!updated) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }));

    logAudit({
      clinicId,
      actionType: "code_blue_session_reconciled",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: sessionId,
      targetType: "code_blue_session",
      actorRole: resolveAuditActorRole(req),
      metadata: { force, forceReason: forceReason?.trim() ?? null },
    });

    return res.json(updated);
  } catch (err) {
    console.error("[code-blue] reconcile session failed", err);
    return res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "RECONCILE_FAILED", message: "Failed to reconcile session", requestId }),
    );
  }
};
