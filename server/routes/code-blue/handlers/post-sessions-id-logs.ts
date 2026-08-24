import type { RequestHandler } from "express";
import type { z } from "zod";
import { randomUUID } from "crypto";
import { db, codeBlueSessions, codeBlueLogEntries } from "../../../db.js";
import { eq, and } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { detectMidsessionManagerDrift } from "../../../lib/authority/code-blue-manager-midsession.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import type { logEntrySchema } from "../schemas.js";

// POST /api/code-blue/sessions/:id/logs — add a log entry
//
// Phase 4 PR 4.4a — clinical gate. Anyone logging a Code Blue event must be
// a clinical-shift actor (vet / senior_technician / technician). System-admin
// identity is denied (allowSystemAdmin:false): an admin who lacks an active
// clinical check-in cannot document clinical events. Master plan §8.
//
// Unlike PATCH /sessions/:id/end (close-out of a single persisted state),
// log writes are per-event documentation by multiple actors. A vet without
// an active shift being denied the ability to log is acceptable: other
// clinical-shift actors in the room can still document. The session is not
// stranded by a denial here.
//
// Mid-session manager-downgrade detection runs AFTER the log write
// (fire-and-forget) and observes whether the PERSISTED manager has drifted
// out of Code-Blue eligibility during the active session. Shadow-only;
// never blocks the log write — the helper internally absorbs all errors.
export const postSessionsIdLogsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id: sessionId } = req.params;
    const body = req.body as z.infer<typeof logEntrySchema>;

    // Verify session belongs to clinic. Phase 4 PR 4.4a selects
    // managerUserId so mid-session detection has the persisted manager.
    const [session] = await db
      .select({
        id: codeBlueSessions.id,
        managerUserId: codeBlueSessions.managerUserId,
      })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);

    if (!session) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }),
      );
    }

    // Idempotency: check for existing key
    const [existing] = await db
      .select({ id: codeBlueLogEntries.id })
      .from(codeBlueLogEntries)
      .where(and(
        eq(codeBlueLogEntries.clinicId, clinicId),
        eq(codeBlueLogEntries.sessionId, sessionId),
        eq(codeBlueLogEntries.idempotencyKey, body.idempotencyKey),
      ))
      .limit(1);

    if (existing) {
      return res.json({ id: existing.id, duplicate: true });
    }

    const entryId = randomUUID();
    await db.insert(codeBlueLogEntries).values({
      id: entryId,
      sessionId,
      clinicId,
      idempotencyKey: body.idempotencyKey,
      elapsedMs: body.elapsedMs,
      label: body.label,
      category: body.category,
      equipmentId: body.equipmentId ?? null,
      loggedByUserId: req.authUser!.id,
      loggedByName: req.authUser!.name,
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_log_entry_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: sessionId,
      targetType: "code_blue_session",
      metadata: { entryId, category: body.category },
    });

    // Phase 4 PR 4.4a — fire-and-forget mid-session manager-drift detection.
    // Shadow-only; never blocks. The helper internally try/catches all
    // dependencies (DB, resolver, audit, metrics) and never throws. The
    // additional .catch here is belt-and-suspenders defense for the
    // never-block contract.
    void detectMidsessionManagerDrift({
      clinicId,
      sessionId,
      managerUserId: session.managerUserId ?? null,
      now: new Date(),
    }).catch((err) => {
      console.error(
        "[code-blue] midsession manager-drift detection failed (shadow); log write already persisted",
        err,
      );
    });

    res.status(201).json({ id: entryId, duplicate: false });
  } catch (err) {
    console.error("[code-blue] add log entry failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "LOG_ENTRY_FAILED", message: "Failed to add log entry", requestId }),
    );
  }
};
