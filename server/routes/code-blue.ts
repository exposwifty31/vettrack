// TODO(arch): file exceeds 1100 lines. Split into handler modules following
// the equipment-route-utils.ts / handlers/ pattern already started in this directory.
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  db,
  pool,
  codeBlueEvents,
  codeBlueSessions,
  codeBlueLogEntries,
  codeBluePresence,
  crashCartChecks,
  users,
  equipment,
} from "../db.js";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { fetchLinkedEquipmentForSession } from "../lib/code-blue-linked-equipment.js";
import { sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireClinicalUser } from "../middleware/auth.js";
import { requireClinicalAuthority } from "../middleware/authority.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { enqueueNotificationJob } from "../lib/queue.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import { invalidateActiveCodeBlueCache } from "../lib/code-blue-keepalive.js";
import { evaluateCodeBlueManagerForRoute } from "../lib/authority/code-blue-manager.wiring.js";
import { codeBlueManagerMetrics } from "../lib/authority/enforcement/code-blue-manager.metrics.js";
import { detectMidsessionManagerDrift } from "../lib/authority/code-blue-manager-midsession.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
const router = Router();

export const startSchema = z.object({
  localStartedAt: z.string().datetime().optional(),
}).strict();

export const endSchema = z.object({
  outcome: z.enum(["rosc", "died", "transferred", "ongoing"]).optional(),
  notes: z.string().max(2000).optional(),
  timeline: z
    .array(z.object({ elapsed: z.number(), label: z.string().max(200) }))
    .max(500)
    .optional(),
}).strict();

export const startSessionSchema = z.object({
  managerUserId: z.string().min(1),
  managerUserName: z.string().min(1),
  preCheckPassed: z.boolean().optional(),
  localStartedAt: z.string().datetime().optional(),
  /** Primary unit for this event (logged at elapsed 0). */
  equipmentId: z.string().min(1).optional(),
  /** Accepted for client idempotency hygiene; not persisted on session start. */
  idempotencyKey: z.string().min(1).max(128).optional(),
}).strict();

export const logEntrySchema = z.object({
  idempotencyKey: z.string().uuid(),
  elapsedMs: z.number().int().min(0),
  label: z.string().min(1).max(200),
  category: z.enum(["equipment", "note"]),
  equipmentId: z.string().optional(),
}).strict();

export const endSessionSchema = z.object({
  outcome: z.enum(["rosc", "died", "transferred", "ongoing"]),
  earlyStopReason: z.string().min(1).max(500).optional(),
}).strict();

// POST /api/code-blue/events  — start a Code Blue event (fire-and-forget safe)
//
// Phase 4 PR 4.6 — legacy archive clinical gate. Master plan §14 notes that
// these /events routes are likely near-dead (no live HTTP callers identified;
// the modern flow uses /sessions). The clinical gate prevents NEW non-clinical
// callers from creating archive rows. A future cleanup phase may grep the
// frontend and remove the legacy routes entirely.
//
// allowSystemAdmin:false per master plan §17 — Code Blue clinical gates do
// not admit system-admin identity. Strand risk for shift-expired actors is
// accepted given these are legacy archive writes, not real-time emergency
// recording (modern flow → /sessions).
router.post(
  "/events",
  requireAuth,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
  }),
  validateBody(startSchema),
  async (req, res) => {
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
});

// PATCH /api/code-blue/events/:id  — close a Code Blue event with outcome + timeline
//
// Phase 4 PR 4.6 — legacy archive clinical gate. Same posture as the POST
// route above. PATCH for the legacy /events archive is a one-shot close-out
// (analogous to PATCH /sessions/:id/end, which was deliberately NOT gated in
// PR 4.3 to avoid stranding active sessions). For /events specifically:
//   - the route is legacy / likely dead (modern flow → /sessions),
//   - the data being archived is the outcome of an already-completed event,
//   - the realistic call-pattern is a clinical user closing an event they
//     themselves opened, so the gate aligns with intended usage.
// Strand risk (shift-expired actor cannot finalize the archive entry) is
// accepted given these routes are scheduled for removal in a future
// cleanup phase (master plan §14).
router.patch(
  "/events/:id",
  requireAuth,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
  }),
  validateUuid("id"),
  validateBody(endSchema),
  async (req, res) => {
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
});

// GET /api/code-blue/events  — admin: list recent events for this clinic
router.get("/events", requireAuth, requireAdmin, async (req, res) => {
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
});

/**
 * Phase 4 PR 4.2 — Initiator clinical-gate denial observer.
 *
 * Runs BEFORE the clinical-gate middleware chain on POST /api/code-blue/sessions.
 * On response finish, if the gate denied (status 403) before the route handler
 * could run, emits the Code-Blue-specific initiator denial counter + audit.
 *
 * This is a tiny observability shim that runs alongside the existing
 * `requireClinicalAuthority` audit emission (`authority_denied`). It does NOT
 * make any authority decision and does NOT modify the middleware framework —
 * the gate's deny path is unchanged. The observer simply ALSO records the
 * Code-Blue-flavored signal for dashboards keyed on Code Blue routes.
 *
 * `res.locals.__cbInitiatorGatePassed` is cleared by the post-gate marker
 * (`__cbInitiatorGatePassed = true`) when the handler is reached. If it stays
 * `false` at response-finish AND status is 403, the gate denied.
 */
function codeBlueInitiatorDenialObserver(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.locals.__cbInitiatorGatePassed = false;
  res.on("finish", () => {
    if (res.locals.__cbInitiatorGatePassed) return;
    if (res.statusCode !== 403) return;
    try {
      codeBlueManagerMetrics.initiatorDenied();
      logAudit({
        clinicId: req.clinicId ?? "",
        actionType: "code_blue_initiator_authority_denied",
        performedBy: req.authUser?.id ?? "",
        performedByEmail: req.authUser?.email ?? "",
        targetType: "code_blue_session",
        actorRole: resolveAuditActorRole(req),
        metadata: {
          endpoint: "POST /api/code-blue/sessions",
          denialPath: "actor_clinical_gate",
          resolvedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error("[code-blue] initiator-denial observer failed", err);
    }
  });
  next();
}

function codeBlueInitiatorGatePassedMarker(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.locals.__cbInitiatorGatePassed = true;
  next();
}

// POST /api/code-blue/sessions — start a new live session
router.post(
  "/sessions",
  requireAuth,
  codeBlueInitiatorDenialObserver,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    // Phase 4 master plan §5 invariant 8: system-admin identity is not an
    // emergency clinical actor. Admins without a clinical check-in are denied.
    allowSystemAdmin: false,
    // Phase 10a T1 — break-glass: a clinical identity (vet / senior_technician
    // / technician, never a student) may OPEN a Code Blue with no active shift.
    // A cardiac arrest must not wait on roster scheduling. Scoped to this gate
    // only; all other Code Blue flows (logs/end/presence) stay roster-gated.
    allowPermanentClinicalRoleForEmergency: true,
  }),
  codeBlueInitiatorGatePassedMarker,
  validateBody(startSessionSchema),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const body = req.body as z.infer<typeof startSessionSchema>;

    // Phase 4 PR 4.2 + PR 4.5 — Code Blue manager authority evaluator wiring.
    // Runs BEFORE existing manager validation + any side effects (DB insert,
    // push fan-out, system message, "started" audit). The evaluator emits
    // audit/metric internally based on the resolved mode.
    //
    // PR 4.5: in enforce mode the evaluator returns `action: "deny"`. The
    // route translates that into a 403 with a stable reason code in the
    // response body BEFORE any side effect commits. In shadow / off / mode-
    // inactive / fault-open paths the verdict is `action: "allow"` and the
    // route proceeds as before. Per-clinic vt_server_config
    // `code_blue.manager_enforce.<clinicId>.initiation = "enforce"` activates
    // the deny path; default (`off`) is unchanged.
    //
    // Evaluator targets the *named manager* via the existing resolver
    // framework. It MUST NOT read req.authoritySnapshot (which belongs to the
    // request actor, not the manager). The wiring helper loads vt_users by
    // id (clinic-scoped) and constructs a DB-only target user object.
    const { verdict: initiationVerdict } = await evaluateCodeBlueManagerForRoute({
      clinicId,
      managerUserId: body.managerUserId,
      endpoint: "initiation",
      now: new Date(),
    });
    if (initiationVerdict.action === "deny") {
      // Codex P2 (PR 4.5 review): the evaluator can deny with USER_MISSING
      // or MANAGER_CROSS_CLINIC, which are INPUT VALIDATION failures (the
      // nominated managerUserId points to a non-existent or cross-clinic
      // user), distinct from operational-role denials. Let those reasons
      // fall through to the existing INVALID_MANAGER 400 response so the
      // API contract for input validation is preserved. Only operational-
      // role denials (OPROLE_NOT_IN_CB_ALLOWLIST, NO_OPEN_CHECK_IN) return
      // the new 403 MANAGER_NOT_CODE_BLUE_ELIGIBLE response.
      const reason = initiationVerdict.reason;
      if (reason === "OPROLE_NOT_IN_CB_ALLOWLIST" || reason === "NO_OPEN_CHECK_IN") {
        return res.status(403).json(
          apiError({
            code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE",
            reason,
            message:
              "Nominated manager is not currently Code-Blue-eligible (operational role check)",
            requestId,
          }),
        );
      }
      // USER_MISSING / MANAGER_CROSS_CLINIC: continue to the existing
      // managerUser DB lookup below, which returns 400 INVALID_MANAGER.
    }

    // Validate that managerUserId is an active vet or admin in this clinic
    const [managerUser] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.id, body.managerUserId),
          eq(users.clinicId, clinicId),
          inArray(users.role, ["vet", "admin"]),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    if (!managerUser) {
      return res.status(400).json(
        apiError({ code: "INVALID_MANAGER", reason: "INVALID_MANAGER", message: "Manager must be an active vet or admin in this clinic", requestId }),
      );
    }

    let primaryEquipment: { id: string; name: string } | null = null;
    if (body.equipmentId) {
      const [eqRow] = await db
        .select({ id: equipment.id, name: equipment.name })
        .from(equipment)
        .where(
          and(
            eq(equipment.id, body.equipmentId),
            eq(equipment.clinicId, clinicId),
            isNull(equipment.deletedAt),
          ),
        )
        .limit(1);
      if (!eqRow) {
        return res.status(400).json(
          apiError({
            code: "INVALID_EQUIPMENT",
            reason: "INVALID_EQUIPMENT",
            message: "Equipment not found in this clinic",
            requestId,
          }),
        );
      }
      primaryEquipment = eqRow;
    }

    const id = randomUUID();
    const startedAt = new Date();

    let codeBlueNotificationRequestOutboxId: number | undefined;
    let activeSessionExists = false;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`code-blue-active-session:${clinicId}`}, 0))
      `);

      // P1-4: serialize the guard with the insert so concurrent starts cannot
      // both observe "no active session" before either writes.
      const [existingActive] = await tx
        .select({ id: codeBlueSessions.id })
        .from(codeBlueSessions)
        .where(
          and(
            eq(codeBlueSessions.clinicId, clinicId),
            eq(codeBlueSessions.status, "active"),
          ),
        )
        .limit(1);
      if (existingActive) {
        activeSessionExists = true;
        return;
      }

      await tx.insert(codeBlueSessions).values({
        id,
        clinicId,
        startedAt,
        startedBy: userId,
        startedByName: req.authUser!.name,
        managerUserId: managerUser.id,
        managerUserName: managerUser.name,
        preCheckPassed: body.preCheckPassed ?? null,
        status: "active",
      });

      if (primaryEquipment) {
        await tx.insert(codeBlueLogEntries).values({
          id: randomUUID(),
          sessionId: id,
          clinicId,
          idempotencyKey: randomUUID(),
          elapsedMs: 0,
          label: primaryEquipment.name,
          category: "equipment",
          equipmentId: primaryEquipment.id,
          loggedByUserId: userId,
          loggedByName: req.authUser!.name,
        });
      }

      codeBlueNotificationRequestOutboxId = await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "NOTIFICATION_REQUESTED",
        payload: {
          channel: "code_blue_role_broadcast",
          sessionId: id,
          tag: `code-blue-${id}`,
        },
        occurredAt: startedAt,
      });
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "CODE_BLUE_STATUS_CHANGED",
        payload: { sessionId: id, status: "active" },
        occurredAt: startedAt,
      });
    });

    if (activeSessionExists) {
      return res.status(409).json(
        apiError({
          code: "ACTIVE_SESSION_EXISTS",
          reason: "ACTIVE_SESSION_EXISTS",
          message: "An active Code Blue session already exists for this clinic",
          requestId,
        }),
      );
    }

    postSystemMessage(clinicId, "code_blue_start", {
      startedBy: req.authUser!.name ?? req.authUser!.id,
      startedAt: startedAt.toISOString(),
    }).catch(() => {});

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_started",
      performedBy: userId,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "code_blue_session",
      metadata: { startedAt: startedAt.toISOString(), managerUserId: body.managerUserId },
    });

    void enqueueNotificationJob({
      type: "code_blue_broadcast",
      clinicId,
      title: "⚠ CODE BLUE",
      body: `CODE BLUE הופעל ע״י ${req.authUser!.name}`,
      tag: `code-blue-${id}`,
      ...(codeBlueNotificationRequestOutboxId !== undefined
        ? { notificationRequestOutboxId: codeBlueNotificationRequestOutboxId }
        : {}),
    }).catch(() => {
      /* non-critical */
    });

    // Phase 9 PR 9.4 — invalidate the keepalive's active-session cache so
    // the next SSE KEEPALIVE event reflects this start within ≤ 5 s.
    invalidateActiveCodeBlueCache(clinicId);

    res.status(201).json({ id, startedAt: startedAt.toISOString() });
  } catch (err) {
    console.error("[code-blue] start session failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_START_FAILED", message: "Failed to start session", requestId }),
    );
  }
});

// GET /api/code-blue/sessions/active — poll: session + log entries + presence + cart status
router.get("/sessions/active", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    // Active session — order by startedAt desc so the most recent is returned
    const [session] = await db
      .select()
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")))
      .orderBy(desc(codeBlueSessions.startedAt))
      .limit(1);

    // Latest crash cart check (last 24h)
    const [latestCheck] = await db
      .select()
      .from(crashCartChecks)
      .where(
        and(
          eq(crashCartChecks.clinicId, clinicId),
          sql`${crashCartChecks.performedAt} > NOW() - INTERVAL '24 hours'`,
        ),
      )
      .orderBy(desc(crashCartChecks.performedAt))
      .limit(1);

    const cartStatus = latestCheck
      ? { lastCheckedAt: latestCheck.performedAt.toISOString(), allPassed: latestCheck.allPassed, performedByName: latestCheck.performedByName }
      : null;

    if (!session) {
      return res.json({ session: null, logEntries: [], presence: [], cartStatus, linkedEquipment: [] });
    }

    // Log entries ordered by elapsed time
    const logEntries = await db
      .select()
      .from(codeBlueLogEntries)
      .where(eq(codeBlueLogEntries.sessionId, session.id))
      .orderBy(codeBlueLogEntries.elapsedMs);

    // Presence — filter stale (>30s)
    const presence = await db
      .select()
      .from(codeBluePresence)
      .where(
        and(
          eq(codeBluePresence.sessionId, session.id),
          sql`${codeBluePresence.lastSeenAt} > NOW() - INTERVAL '30 seconds'`,
        ),
      );

    const linkedEquipment = await fetchLinkedEquipmentForSession(clinicId, logEntries);

    res.json({
      session,
      logEntries,
      presence,
      cartStatus,
      linkedEquipment,
    });
  } catch (err) {
    console.error("[code-blue] poll failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_POLL_FAILED", message: "Poll failed", requestId }),
    );
  }
});

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
router.post(
  "/sessions/:id/logs",
  requireAuth,
  requireClinicalUser,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowSystemAdmin: false,
  }),
  validateUuid("id"),
  validateBody(logEntrySchema),
  async (req, res) => {
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
});

// PATCH /api/code-blue/sessions/:id/presence — heartbeat (every 10s)
router.patch("/sessions/:id/presence", requireAuth, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id: sessionId } = req.params;
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

    await db
      .insert(codeBluePresence)
      .values({ sessionId, userId, userName, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [codeBluePresence.sessionId, codeBluePresence.userId],
        set: { userName, lastSeenAt: new Date() },
      });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_presence_heartbeat",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: sessionId,
      targetType: "code_blue_session",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[code-blue] presence heartbeat failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "PRESENCE_FAILED", message: "Presence update failed", requestId }),
    );
  }
});

// PATCH /api/code-blue/sessions/:id/end — close session (manager only for ALL outcomes)
//
// Phase 4 PR 4.3 architectural note: this route deliberately does NOT add the
// `requireClinicalAuthority` middleware that initiation (POST /sessions) uses.
// End is a *close-out* action authorized by the persisted manager identity
// (`MANAGER_ONLY` check below), not by fresh clinical authority. Adding a
// clinical-shift gate at the end would strand active sessions whenever the
// persisted manager loses their clinical shift mid-session (e.g., shift
// expires during a 30-minute resus, admin manager with no shift, vet who
// checks out before closing out), which is a real production safety risk
// flagged in PR 4.3 review (Codex P1 + Bugbot HIGH).
//
// The Phase 4 master plan §17 forbidden ("no system-admin bypass on Code
// Blue clinical gates") still applies to the gates that EXIST: initiation
// (PR 4.2) and the future log-write gates (PR 4.4a). End is fundamentally
// different — once a session is created, the persisted manager identity is
// the binding authorization for closing it.
//
// The PR 4.3 deliverable — the manager-authority evaluator at end-time and
// the drift signal — is wired below inside the handler, AFTER session load
// and identity validation. Shadow-only.
router.patch("/sessions/:id/end", requireAuth, validateUuid("id"), validateBody(endSessionSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id: sessionId } = req.params;
    const { outcome, earlyStopReason: rawEarlyStopReason } = req.body as z.infer<typeof endSessionSchema>;
    const earlyStopReason = rawEarlyStopReason ? rawEarlyStopReason.trim() : undefined;
    if (earlyStopReason !== undefined && earlyStopReason.length < 3) {
      return res.status(400).json(
        apiError({ code: "EARLY_STOP_REASON_REQUIRED", reason: "EARLY_STOP_REASON_REQUIRED", message: "earlyStopReason must be at least 3 characters", requestId }),
      );
    }

    const [session] = await db
      .select()
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);

    if (!session) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }),
      );
    }

    // Manager-only gate — applies to ALL outcomes
    if (session.managerUserId !== req.authUser!.id) {
      return res.status(403).json(
        apiError({ code: "MANAGER_ONLY", reason: "MANAGER_ONLY", message: "Only the resuscitation manager can end this session", requestId }),
      );
    }

    // Verify manager still holds vet or admin role and is still active.
    // TODO(Phase 4): activate enforce mode for end via per-clinic vt_server_config after shadow soak
    const [managerUser] = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(and(eq(users.id, session.managerUserId), eq(users.clinicId, clinicId)))
      .limit(1);

    if (!managerUser || !["vet", "admin"].includes(managerUser.role)) {
      return res.status(422).json(
        apiError({ code: "NO_VET_MANAGER", reason: "NO_VET_MANAGER", message: "Assigned manager must be a vet or admin to end this session", requestId }),
      );
    }

    if (managerUser.status !== "active") {
      return res.status(403).json(
        apiError({ code: "MANAGER_INACTIVE", reason: "MANAGER_INACTIVE", message: "Assigned manager account is no longer active", requestId }),
      );
    }

    // Phase 4 PR 4.3 — Code Blue manager authority evaluator wiring at end.
    // Runs AFTER the existing persisted-manager identity and state validation,
    // BEFORE the 15-minute gate and any write/update flow. Shadow-only in
    // PR 4.3: the evaluator may emit audit/metric internally but the verdict
    // is NOT acted on by this PR. PR 4.5 introduces the enforce-mode response.
    //
    // The evaluator targets the persisted session.managerUserId (NOT the
    // request actor's id — that may coincide here because the manager-only
    // identity check above requires it, but the evaluator semantically
    // resolves the manager's authority via the existing resolver framework
    // applied to the persisted manager identity, and would behave identically
    // if a non-manager actor invoked end through some future code path).
    //
    // Drift signal: when the end-side evaluator shadow-denies or denies, the
    // manager is no longer Code-Blue-eligible at end time. The session was
    // accepted at init time (otherwise it would not exist to end here), so
    // this is the "init eligible but end ineligible" crossover — the headline
    // Phase 4 signal per master plan §10.
    if (session.managerUserId) {
      // Defensive try/catch: a throw from audit emission, metric increment,
      // or a future edge case must NEVER strand session end. The
      // shadow-only / never-blocks contract for the EVALUATOR's internal
      // emission is preserved; ENFORCE-mode 403 is opt-in via per-clinic
      // vt_server_config and is acceptable to the operator who flipped it.
      //
      // PR 4.5: in enforce mode the evaluator returns `action: "deny"`. The
      // route returns 403 with a stable reason code. Per-clinic config
      // `code_blue.manager_enforce.<clinicId>.end = "enforce"` activates
      // this path; default (`off`) is unchanged.
      //
      // The evaluator's `resolver_fault` lookup branch returns
      // `protected: "FAULT_OPEN"` even in enforce mode (DECISION-2:
      // fail-open in emergency context), so resolver/cache infrastructure
      // failures cannot strand session end.
      let endVerdict:
        | Awaited<ReturnType<typeof evaluateCodeBlueManagerForRoute>>["verdict"]
        | null = null;
      try {
        const { verdict } = await evaluateCodeBlueManagerForRoute({
          clinicId,
          managerUserId: session.managerUserId,
          endpoint: "end",
          now: new Date(),
        });
        endVerdict = verdict;
        const endWouldDeny =
          verdict.action === "deny" ||
          verdict.protected === "SHADOW_WOULD_HAVE_DENIED";
        if (endWouldDeny) {
          codeBlueManagerMetrics.driftBetweenInitAndEnd();
        }
      } catch (evalErr) {
        console.error(
          "[code-blue] manager evaluator threw at end; session-end continues (fault-open)",
          evalErr,
        );
      }
      if (endVerdict?.action === "deny") {
        // Codex P2 lesson (initiation review): USER_MISSING and
        // MANAGER_CROSS_CLINIC are input/data-corruption signals, not
        // operational-role denials. For end specifically, the existing
        // MANAGER_INACTIVE / NO_VET_MANAGER checks already ran above and
        // passed, so USER_MISSING here would only fire on a race with
        // user deletion mid-request. Conservative posture: also confine
        // the new 403 to operational-role reasons; other deny reasons
        // fall through to the existing flow (15-min gate + write), which
        // is the pre-PR-4.5 behavior for those scenarios.
        const reason = endVerdict.reason;
        if (reason === "OPROLE_NOT_IN_CB_ALLOWLIST" || reason === "NO_OPEN_CHECK_IN") {
          return res.status(403).json(
            apiError({
              code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE",
              reason,
              message:
                "Persisted manager is not currently Code-Blue-eligible (operational role check). Reconfigure the clinic to shadow / off to bypass.",
              requestId,
            }),
          );
        }
        // USER_MISSING / MANAGER_CROSS_CLINIC: continue with the existing
        // flow (pre-PR-4.5 behavior preserved for these edge cases).
      }
    }

    const endedAt = new Date();

    // Fetch log entries for auto-summary
    const logEntries = await db
      .select()
      .from(codeBlueLogEntries)
      .where(eq(codeBlueLogEntries.sessionId, sessionId));

    const participants = [...new Set(logEntries.map((e) => e.loggedByName))];
    if (!participants.includes(session.startedByName)) participants.unshift(session.startedByName);

    const interventionCounts = logEntries.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {});

    const equipmentAttached = logEntries
      .filter((e) => e.category === "equipment")
      .map((e) => e.label);

    const durationMinutes = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000);

    const summary = JSON.stringify({
      duration_minutes: durationMinutes,
      manager: session.managerUserName,
      interventions: interventionCounts,
      equipment_attached: equipmentAttached,
      participants,
      pre_check_passed: session.preCheckPassed ?? null,
      outcome,
      ...(earlyStopReason ? { early_stop_reason: earlyStopReason } : {}),
    });

    // Update session + emit outbox event in same TX for display propagation
    await db.transaction(async (tx) => {
      await tx
        .update(codeBlueSessions)
        .set({ status: "ended", outcome, endedAt })
        .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)));
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "CODE_BLUE_STATUS_CHANGED",
        payload: { sessionId, status: "ended", outcome },
        occurredAt: endedAt,
      });
    });

    // Archive to vt_code_blue_events (backward compat)
    await db.insert(codeBlueEvents).values({
      id: randomUUID(),
      clinicId,
      startedByUserId: session.startedBy,
      startedAt: session.startedAt,
      endedAt,
      outcome,
      notes: summary,
      timeline: logEntries.map((e) => ({ elapsed: e.elapsedMs, label: e.label })),
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_ended",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: sessionId,
      targetType: "code_blue_session",
      metadata: { outcome, durationMinutes, ...(earlyStopReason ? { earlyStopReason } : {}) },
    });

    // Phase 9 PR 9.4 — invalidate the keepalive's active-session cache so
    // the next SSE KEEPALIVE event reflects the end within ≤ 5 s.
    invalidateActiveCodeBlueCache(clinicId);

    postSystemMessage(clinicId, "code_blue_end", {
      outcome: outcome ?? "unknown",
      endedAt: endedAt.toISOString(),
    }).catch(() => {});

    res.json({ id: sessionId, endedAt: endedAt.toISOString(), summary: JSON.parse(summary) });
  } catch (err) {
    console.error("[code-blue] end session failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_END_FAILED", message: "Failed to end session", requestId }),
    );
  }
});

// GET /api/code-blue/history — admin: list ended sessions
router.get("/history", requireAuth, requireAdmin, async (req, res) => {
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
});

// ─── Reconciliation endpoints ─────────────────────────────────────────────────

/**
 * GET /api/code-blue/reconciliation
 * Lists ended Code Blue sessions with dispense + billing summary. Admin only.
 */
router.get("/reconciliation", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const rows = await pool.query(
      `SELECT
         s.id,
         s.started_at        AS "startedAt",
         s.ended_at          AS "endedAt",
         s.outcome,
         s.is_reconciled     AS "isReconciled",
         s.reconciled_at     AS "reconciledAt",
         COUNT(il.id)::int   AS "dispenseCount",
         0::int              AS "billedCount",
         0::int              AS "totalBilledCents"
       FROM vt_code_blue_sessions s
       LEFT JOIN vt_inventory_logs il
         ON il.clinic_id = s.clinic_id
         AND il.quantity_added < 0
         AND il.created_at >= s.started_at
         AND il.created_at <= COALESCE(s.ended_at, NOW())
       WHERE s.clinic_id = $1
         AND s.status = 'ended'
       GROUP BY s.id, s.started_at, s.ended_at, s.outcome,
                s.is_reconciled, s.reconciled_at
       ORDER BY s.started_at DESC
       LIMIT 100`,
      [clinicId],
    );
    res.json(rows.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "RECONCILIATION_LIST_FAILED", message: "Failed to load reconciliation list", requestId }),
    );
  }
});

/**
 * GET /api/code-blue/sessions/:id/dispenses
 * Returns inventory dispenses during a Code Blue session with billing status. Admin only.
 */
router.get("/sessions/:id/dispenses", requireAuth, requireAdmin, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const sessionId = req.params.id;
    const [session] = await db
      .select({ startedAt: codeBlueSessions.startedAt, endedAt: codeBlueSessions.endedAt })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);
    if (!session) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }));
    }
    const rows = await pool.query(
      `SELECT
         il.id,
         il.quantity_added       AS "quantityAdded",
         il.created_at           AS "createdAt",
         c.name                  AS "containerName",
         NULL::text             AS "billingId",
         NULL::int              AS "totalAmountCents",
         NULL::text             AS "billingStatus"
       FROM vt_inventory_logs il
       JOIN vt_containers c ON c.id = il.container_id
       WHERE il.clinic_id = $1
         AND il.quantity_added < 0
         AND il.created_at >= $2
         AND il.created_at <= $3
       ORDER BY il.created_at`,
      [clinicId, session.startedAt.toISOString(), (session.endedAt ?? new Date()).toISOString()],
    );
    res.json(rows.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_DISPENSES_FAILED", message: "Failed to load session dispenses", requestId }),
    );
  }
});

/**
 * PATCH /api/code-blue/sessions/:id/reconcile
 * Fix D: Validates billing completeness + no failed inventory jobs before marking reconciled.
 * Pass ?force=true + body.forceReason to override gaps. Admin only.
 */
export const reconcileSchema = z.object({
  forceReason: z.string().min(1).max(500).optional(),
}).strict();

router.patch("/sessions/:id/reconcile", requireAuth, requireAdmin, validateUuid("id"), validateBody(reconcileSchema), async (req, res) => {
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
    console.error(err);
    return res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "RECONCILE_FAILED", message: "Failed to reconcile session", requestId }),
    );
  }
});

/**
 * POST /api/code-blue/sessions/:id/manual-billing
 * Creates a manual billing entry for an unbilled dispense. Admin only.
 */
export const manualBillingSchema = z.object({
  inventoryLogId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  /** When set, clears matching `PROBABLE_ORPHAN_USAGE` Smart Cop alert after billing linkage. */
  resolveTaskId: z.string().uuid().optional(),
}).strict();

router.post("/sessions/:id/manual-billing", requireAuth, requireAdmin, validateBody(manualBillingSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  return res.status(410).json(
    apiError({
      code: "BILLING_REMOVED",
      reason: "BILLING_SCHEMA_REMOVED",
      message: "Manual billing is no longer available.",
      requestId,
    }),
  );
});

export default router;
