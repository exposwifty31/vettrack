import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  db,
  pool,
  billingLedger,
  codeBlueEvents,
  codeBlueSessions,
  codeBlueLogEntries,
  codeBluePresence,
  crashCartChecks,
  equipment,
  animals,
  hospitalizations,
  users,
} from "../db.js";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { inventoryJobs } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { enqueueNotificationJob } from "../lib/queue.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";

const router = Router();

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(p: { code: string; reason: string; message: string; requestId: string }) {
  return { code: p.code, error: p.code, reason: p.reason, message: p.message, requestId: p.requestId };
}

const startSchema = z.object({
  localStartedAt: z.string().datetime().optional(),
});

const endSchema = z.object({
  outcome: z.enum(["rosc", "died", "transferred", "ongoing"]).optional(),
  notes: z.string().max(2000).optional(),
  timeline: z
    .array(z.object({ elapsed: z.number(), label: z.string().max(200) }))
    .max(500)
    .optional(),
});

const startSessionSchema = z.object({
  managerUserId: z.string().min(1),
  managerUserName: z.string().min(1),
  patientId: z.string().optional(),
  hospitalizationId: z.string().optional(),
  preCheckPassed: z.boolean().optional(),
  localStartedAt: z.string().datetime().optional(),
});

const logEntrySchema = z.object({
  idempotencyKey: z.string().uuid(),
  elapsedMs: z.number().int().min(0),
  label: z.string().min(1).max(200),
  category: z.enum(["drug", "shock", "cpr", "note", "equipment"]),
  equipmentId: z.string().optional(),
});

const endSessionSchema = z.object({
  outcome: z.enum(["rosc", "died", "transferred", "ongoing"]),
  earlyStopReason: z.string().min(1).max(500).optional(),
});

// POST /api/code-blue/events  — start a Code Blue event (fire-and-forget safe)
router.post("/events", requireAuth, validateBody(startSchema), async (req, res) => {
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
router.patch("/events/:id", requireAuth, validateUuid("id"), validateBody(endSchema), async (req, res) => {
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

// POST /api/code-blue/sessions — start a new live session
router.post("/sessions", requireAuth, validateBody(startSessionSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const body = req.body as z.infer<typeof startSessionSchema>;

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

    const id = randomUUID();
    const startedAt = new Date();

    let codeBlueNotificationRequestOutboxId: number | undefined;
    await db.transaction(async (tx) => {
      await tx.insert(codeBlueSessions).values({
        id,
        clinicId,
        startedAt,
        startedBy: userId,
        startedByName: req.authUser!.name,
        managerUserId: managerUser.id,
        managerUserName: managerUser.name,
        patientId: body.patientId ?? null,
        hospitalizationId: body.hospitalizationId ?? null,
        preCheckPassed: body.preCheckPassed ?? null,
        status: "active",
      });
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
    });

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

    // Active session
    const [session] = await db
      .select()
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")))
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
      return res.json({ session: null, logEntries: [], presence: [], cartStatus });
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

    // Patient details if linked
    let patientName: string | null = null;
    let patientWeight: number | null = null;
    if (session.patientId) {
      const [animal] = await db
        .select({ name: animals.name, weight: animals.weightKg })
        .from(animals)
        .where(and(eq(animals.id, session.patientId), eq(animals.clinicId, clinicId)))
        .limit(1);
      if (animal) {
        patientName = animal.name;
        patientWeight = animal.weight !== null ? Number(animal.weight) : null;
      }
    }

    res.json({
      session: { ...session, patientName, patientWeight },
      logEntries,
      presence,
      cartStatus,
    });
  } catch (err) {
    console.error("[code-blue] poll failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_POLL_FAILED", message: "Poll failed", requestId }),
    );
  }
});

// POST /api/code-blue/sessions/:id/logs — add a log entry
router.post("/sessions/:id/logs", requireAuth, validateUuid("id"), validateBody(logEntrySchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id: sessionId } = req.params;
    const body = req.body as z.infer<typeof logEntrySchema>;

    // Verify session belongs to clinic
    const [session] = await db
      .select({ id: codeBlueSessions.id, patientId: codeBlueSessions.patientId })
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

    // If equipment log: mark equipment as checked out to this patient
    if (body.category === "equipment" && body.equipmentId && session.patientId) {
      await db
        .update(equipment)
        .set({
          checkedOutById: req.authUser!.id,
          checkedOutByEmail: req.authUser!.email ?? "",
          checkedOutAt: new Date(),
          checkedOutLocation: `Code Blue — patient ${session.patientId}`,
        })
        .where(and(eq(equipment.id, body.equipmentId), eq(equipment.clinicId, clinicId)));
    }

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
    // TODO(Phase 4 + Phase 2.5): enforce active-shift operational-role manager authority
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

    // 15-minute minimum gate — waivable only with an explicit earlyStopReason
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
    const durationMs = Date.now() - session.startedAt.getTime();
    if (durationMs < FIFTEEN_MINUTES_MS && !earlyStopReason) {
      return res.status(422).json(
        apiError({ code: "TOO_EARLY", reason: "TOO_EARLY", message: "Session must run for at least 15 minutes, or supply an earlyStopReason", requestId }),
      );
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

    // Update session
    await db
      .update(codeBlueSessions)
      .set({ status: "ended", outcome, endedAt })
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)));

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
         s.patient_id        AS "patientId",
         s.is_reconciled     AS "isReconciled",
         s.reconciled_at     AS "reconciledAt",
         a.name              AS "patientName",
         COUNT(il.id)::int   AS "dispenseCount",
         COUNT(bl.id) FILTER (WHERE bl.id IS NOT NULL)::int AS "billedCount",
         COALESCE(SUM(bl.total_amount_cents) FILTER (WHERE bl.status != 'voided'), 0)::int AS "totalBilledCents"
       FROM vt_code_blue_sessions s
       LEFT JOIN vt_animals a ON a.id = s.patient_id
       LEFT JOIN vt_inventory_logs il
         ON il.clinic_id = s.clinic_id
         AND il.quantity_added < 0
         AND il.created_at >= s.started_at
         AND il.created_at <= COALESCE(s.ended_at, NOW())
       LEFT JOIN vt_billing_ledger bl
         ON bl.idempotency_key = 'adjustment_' || il.id
       WHERE s.clinic_id = $1
         AND s.status = 'ended'
       GROUP BY s.id, s.started_at, s.ended_at, s.outcome, s.patient_id,
                s.is_reconciled, s.reconciled_at, a.name
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
router.get("/sessions/:id/dispenses", requireAuth, requireAdmin, async (req, res) => {
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
         il.animal_id            AS "animalId",
         c.name                  AS "containerName",
         bl.id                   AS "billingId",
         bl.total_amount_cents   AS "totalAmountCents",
         bl.status               AS "billingStatus"
       FROM vt_inventory_logs il
       JOIN vt_containers c ON c.id = il.container_id
       LEFT JOIN vt_billing_ledger bl
         ON bl.idempotency_key = 'adjustment_' || il.id
         AND bl.status != 'voided'
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
const reconcileSchema = z.object({
  forceReason: z.string().min(1).max(500).optional(),
});

router.patch("/sessions/:id/reconcile", requireAuth, requireAdmin, validateBody(reconcileSchema), async (req, res) => {
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

    if (!force) {
      // Fix D: verify billing completeness and no failed inventory jobs
      const sessionEnd = session.endedAt ?? new Date();
      const dispenseVsBillingResult = await pool.query<{ dispense_count: number; billed_count: number }>(
        `SELECT
           COUNT(il.id)::int AS dispense_count,
           COUNT(bl.id) FILTER (WHERE bl.id IS NOT NULL AND bl.status != 'voided')::int AS billed_count
         FROM vt_inventory_logs il
         LEFT JOIN vt_billing_ledger bl
           ON bl.idempotency_key = 'adjustment_' || il.id
         WHERE il.clinic_id = $1
           AND il.quantity_added < 0
           AND il.created_at >= $2
           AND il.created_at <= $3`,
        [clinicId, session.startedAt.toISOString(), sessionEnd.toISOString()],
      );

      const dispenseCount = dispenseVsBillingResult.rows[0]?.dispense_count ?? 0;
      const billedCount = dispenseVsBillingResult.rows[0]?.billed_count ?? 0;
      const billingGapCount = dispenseCount - billedCount;

      // Check failed inventory jobs overlapping this session window
      const failedJobsResult = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM vt_inventory_jobs
         WHERE clinic_id = $1
           AND status = 'failed'
           AND created_at >= $2
           AND created_at <= $3`,
        [clinicId, session.startedAt.toISOString(), sessionEnd.toISOString()],
      );
      const failedJobCount = failedJobsResult.rows[0]?.count ?? 0;

      if (billingGapCount > 0 || failedJobCount > 0) {
        return res.status(409).json({
          code: "UNRESOLVED_RECONCILIATION",
          error: "UNRESOLVED_RECONCILIATION",
          reason: "UNRESOLVED_RECONCILIATION",
          message: "Cannot reconcile: billing or inventory gaps remain. Resolve gaps or pass ?force=true with forceReason.",
          billingGapCount,
          failedInventoryJobCount: failedJobCount,
          dispenseCount,
          billedCount,
          requestId,
        });
      }
    }

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
const manualBillingSchema = z.object({
  inventoryLogId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  animalId: z.string().nullable().optional(),
  /** When set, clears matching `PROBABLE_ORPHAN_USAGE` Smart Cop alert after billing linkage. */
  resolveTaskId: z.string().uuid().optional(),
});

router.post("/sessions/:id/manual-billing", requireAuth, requireAdmin, validateBody(manualBillingSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const sessionId = req.params.id;
    const b = req.body as z.infer<typeof manualBillingSchema>;
    const [session] = await db
      .select({ clinicId: codeBlueSessions.clinicId })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);
    if (!session) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }));
    }
    const { randomUUID } = await import("crypto");
    const id = randomUUID();
    const idempotencyKey = `adjustment_${b.inventoryLogId}`;
    const [row] = await db.transaction(async (tx) => {
      await tx.insert(billingLedger).values({
        id,
        clinicId,
        animalId: b.animalId ?? null,
        itemType: "CONSUMABLE",
        itemId: b.itemId,
        quantity: b.quantity,
        unitPriceCents: b.unitPriceCents,
        totalAmountCents: b.unitPriceCents * b.quantity,
        idempotencyKey,
        status: "pending",
      }).onConflictDoNothing();
      const [ledgerRow] = await tx.select().from(billingLedger).where(eq(billingLedger.idempotencyKey, idempotencyKey)).limit(1);
      const resolvedId = ledgerRow?.id ?? id;
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "SHADOW_ORPHAN_ALERT_RESOLVED",
        payload: {
          billingLedgerId: resolvedId,
          inventoryLogId: b.inventoryLogId,
          resolution: "retroactive_billing_link",
          source: "code_blue_manual_billing",
          ...(b.resolveTaskId ? { taskId: b.resolveTaskId } : {}),
        },
      });
      return [ledgerRow] as const;
    });
    logAudit({
      clinicId,
      actionType: "billing_charge_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: row?.id ?? id,
      targetType: "billing_ledger",
      actorRole: resolveAuditActorRole(req),
      metadata: { source: "code_blue_manual", sessionId, inventoryLogId: b.inventoryLogId },
    });
    res.status(201).json(row ?? { id, idempotencyKey, status: "pending" });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "MANUAL_BILLING_FAILED", message: "Failed to create manual billing entry", requestId }),
    );
  }
});

export default router;
