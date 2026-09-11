import type { RequestHandler } from "express";
import { db, codeBlueSessions, codeBluePresence } from "../../../db.js";
import { eq, and, sql } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import { param } from "../../../lib/route-params.js";

// PATCH /api/code-blue/sessions/:id/presence — heartbeat (every 10s)
export const patchSessionsIdPresenceHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const sessionId = param(req, "id");
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const userName = req.authUser!.name;

    // Verify session belongs to this clinic
    const [session] = await db
      .select({ id: codeBlueSessions.id })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);

    if (!session) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }),
      );
    }

    // vt_code_blue_presence is the liveness record (PK session+user, last_seen_at
    // refreshed on every beat). The audit trail records the JOIN only: `xmax = 0`
    // is true on the row Postgres just inserted and false on an updated one, so
    // a 10 s heartbeat no longer writes an append-only audit row per beat (#250).
    const [presence] = await db
      .insert(codeBluePresence)
      .values({ sessionId, userId, userName, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [codeBluePresence.sessionId, codeBluePresence.userId],
        set: { userName, lastSeenAt: new Date() },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });

    if (presence?.inserted) {
      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "code_blue_presence_joined",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        targetId: sessionId,
        targetType: "code_blue_session",
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[code-blue] presence heartbeat failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "PRESENCE_FAILED", message: "Presence update failed", requestId }),
    );
  }
};
