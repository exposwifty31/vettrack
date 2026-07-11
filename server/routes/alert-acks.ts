import { Router } from "express";
import { randomUUID } from "crypto";
import { db, alertAcks, equipment, users } from "../db.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { sendPushToOthers, checkDedupe } from "../lib/push.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

/*
 * PERMISSIONS MATRIX — /api/alert-acks
 * ─────────────────────────────────────────────────────
 * GET  /             student+            Read current acknowledgments (view-only for all)
 * POST /             senior_technician+  Take ownership ("Who's Handling This")
 * PATCH /:id/resolve senior_technician+  Mark RESOLVED ("Treat Now" — intent to close)
 * ─────────────────────────────────────────────────────
 *
 * Ownership (taking/resolving an alert) is restricted to the equipment-management
 * tier — senior_technician and above (incl. vet, admin). Everyone down to student
 * can still READ who is handling each alert; only authorized users can claim it.
 * To restrict further (e.g. an explicit per-user allowlist), tighten the gate here
 * and the matching client predicate `canOwnAlerts` in src/pages/alerts.tsx.
 *
 * Two-level model:
 *   SEEN     — user is aware; system CONTINUES alerting
 *   RESOLVED — user has handled it; system STOPS alerting
 *
 * CRITICAL RULE: resolution is intent-only, not truth.
 * The alert-reminder scheduler re-evaluates the underlying condition.
 * If the condition persists after a RESOLVED mark, the system may re-escalate.
 *
 * Rows are NEVER deleted — they remain visible and auditable.
 */

const router = Router();

// Actor identity for display MUST be the display name, never the email — NULLIF
// collapses the default empty-string vt_users.name to null so the client falls
// back to a neutral label instead of rendering blank text or the raw email.
const ACK_COLUMNS = {
  id: alertAcks.id,
  clinicId: alertAcks.clinicId,
  equipmentId: alertAcks.equipmentId,
  alertType: alertAcks.alertType,
  acknowledgedById: alertAcks.acknowledgedById,
  acknowledgedByEmail: alertAcks.acknowledgedByEmail,
  acknowledgedByDisplayName: sql<string | null>`NULLIF(${users.name}, '')`,
  acknowledgedAt: alertAcks.acknowledgedAt,
  remindAt: alertAcks.remindAt,
  remindedAt: alertAcks.remindedAt,
  ackStatus: alertAcks.ackStatus,
  resolvedAt: alertAcks.resolvedAt,
  resolvedById: alertAcks.resolvedById,
  resolutionNote: alertAcks.resolutionNote,
};

// NOTE: each call site below repeats `.select(ACK_COLUMNS).from(alertAcks).leftJoin(users, ...)`
// rather than sharing one query-builder helper. That's deliberate — a shared helper
// would collapse every `.from(alertAcks)` into one source-text occurrence, and the
// P1 cross-tenant structural regression test (tests/cross-tenant-denial.test.ts)
// locks clinicId scoping by scanning for `.from(alertAcks) ... .where(...)` pairs
// at each call site. Keep them inline so that guard stays meaningful.

// GET /api/alert-acks — return all current acknowledgments (not resolved unless asked)
router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const includeResolved = req.query.includeResolved === "true";

    const rows = await db
      .select(ACK_COLUMNS)
      .from(alertAcks)
      .leftJoin(users, and(eq(alertAcks.acknowledgedById, users.id), eq(users.clinicId, clinicId)))
      .where(
        includeResolved
          ? eq(alertAcks.clinicId, clinicId)
          : and(eq(alertAcks.clinicId, clinicId), eq(alertAcks.ackStatus, "SEEN")),
      );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ALERT_ACKS_LIST_FAILED",
        message: "הבאת אישורי ההתראות נכשלה",
        requestId,
      }),
    );
  }
});

// POST /api/alert-acks — take ownership ("Who's Handling This") — senior_technician+ only
// SEEN does NOT stop escalation. System continues to remind.
router.post("/", requireAuth, requireEffectiveRole("senior_technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { equipmentId, alertType } = req.body;
    if (!equipmentId || !alertType) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "MISSING_ALERT_ACK_FIELDS",
          message: "equipmentId and alertType required",
          requestId,
        }),
      );
    }

    // Check if already acked (upsert: update status back to SEEN if previously resolved and re-triggered)
    const [existing] = await db
      .select(ACK_COLUMNS)
      .from(alertAcks)
      .leftJoin(users, and(eq(alertAcks.acknowledgedById, users.id), eq(users.clinicId, clinicId)))
      .where(
        and(
          eq(alertAcks.clinicId, clinicId),
          eq(alertAcks.equipmentId, equipmentId),
          eq(alertAcks.alertType, alertType),
        ),
      )
      .limit(1);

    if (existing) {
      // Already acked — update to SEEN if it was resolved (condition re-triggered)
      if (existing.ackStatus === "RESOLVED") {
        await db
          .update(alertAcks)
          .set({
            ackStatus: "SEEN",
            acknowledgedById: req.authUser!.id,
            acknowledgedByEmail: req.authUser!.email,
            acknowledgedAt: new Date(),
            resolvedAt: null,
            resolvedById: null,
            resolutionNote: null,
            remindedAt: null,
            remindAt: computeRemindAt(alertType),
          })
          .where(eq(alertAcks.id, existing.id));
        const [updated] = await db
          .select(ACK_COLUMNS)
          .from(alertAcks)
          .leftJoin(users, and(eq(alertAcks.acknowledgedById, users.id), eq(users.clinicId, clinicId)))
          .where(and(eq(alertAcks.clinicId, clinicId), eq(alertAcks.id, existing.id)))
          .limit(1);
        return res.json(updated);
      }
      return res.json(existing); // Already SEEN — idempotent
    }

    const REMINDER_DELAY_MS = Number(process.env.ALERT_REMINDER_DELAY_MS) || 30 * 60 * 1000;
    const CRITICAL_HIGH_ALERT_TYPES = new Set(["issue", "overdue"]);
    const remindAt = CRITICAL_HIGH_ALERT_TYPES.has(alertType)
      ? new Date(Date.now() + REMINDER_DELAY_MS)
      : null;

    const [ack] = await db
      .insert(alertAcks)
      .values({
        id: randomUUID(),
        clinicId,
        equipmentId,
        alertType,
        acknowledgedById: req.authUser!.id,
        acknowledgedByEmail: req.authUser!.email,
        remindAt,
        ackStatus: "SEEN",
      })
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "alert_seen",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: equipmentId,
      targetType: "equipment",
      metadata: { alertType, ackStatus: "SEEN" },
    });

    // The acknowledger is always req.authUser here, so the display name is
    // known without a re-query — never fall back to the raw email.
    res.status(201).json({ ...ack, acknowledgedByDisplayName: req.authUser!.name || null });

    const key = `ack:${equipmentId}:${alertType}`;
    if (!checkDedupe(equipmentId, key)) {
      sendPushToOthers(clinicId, req.authUser!.id, {
        title: "Alert Seen",
        body: `${req.authUser!.email} has seen the ${alertType.replace(/_/g, " ")} alert`,
        tag: `ack:${equipmentId}:${alertType}`,
        url: `/`,
      }).catch(() => {});
    }
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ALERT_ACK_CREATE_FAILED",
        message: "אישור ההתראה נכשל",
        requestId,
      }),
    );
  }
});

// PATCH /api/alert-acks/:id/resolve — mark as RESOLVED (intent-only, not truth)
// The alert-reminder scanner validates the underlying condition and may re-open.
router.patch("/:id/resolve", requireAuth, requireEffectiveRole("senior_technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const ackId = req.params.id;
    const resolutionNote = typeof req.body?.resolutionNote === "string" ? req.body.resolutionNote.trim() : null;

    const [existing] = await db
      .select(ACK_COLUMNS)
      .from(alertAcks)
      .leftJoin(users, and(eq(alertAcks.acknowledgedById, users.id), eq(users.clinicId, clinicId)))
      .where(and(eq(alertAcks.id, ackId), eq(alertAcks.clinicId, clinicId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "ACK_NOT_FOUND", message: "Alert acknowledgement not found", requestId }),
      );
    }

    if (existing.ackStatus === "RESOLVED") {
      return res.json(existing); // Idempotent — already resolved
    }

    const now = new Date();
    await db
      .update(alertAcks)
      .set({
        ackStatus: "RESOLVED",
        resolvedAt: now,
        resolvedById: req.authUser!.id,
        resolutionNote,
      })
      .where(and(eq(alertAcks.id, ackId), eq(alertAcks.clinicId, clinicId)));

    const [updated] = await db
      .select(ACK_COLUMNS)
      .from(alertAcks)
      .leftJoin(users, and(eq(alertAcks.acknowledgedById, users.id), eq(users.clinicId, clinicId)))
      .where(and(eq(alertAcks.clinicId, clinicId), eq(alertAcks.id, ackId)))
      .limit(1);

    if (!updated) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "ACK_NOT_FOUND", message: "Alert acknowledgement not found", requestId }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "alert_resolved",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: existing.equipmentId,
      targetType: "equipment",
      metadata: {
        alertType: existing.alertType,
        ackStatus: "RESOLVED",
        resolutionNote,
        resolvedAt: now.toISOString(),
        resolvedById: req.authUser!.id,
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ALERT_RESOLVE_FAILED",
        message: "שמירת סגירת ההתראה נכשלה",
        requestId,
      }),
    );
  }
});

function computeRemindAt(alertType: string): Date | null {
  const REMINDER_DELAY_MS = Number(process.env.ALERT_REMINDER_DELAY_MS) || 30 * 60 * 1000;
  const CRITICAL_HIGH_ALERT_TYPES = new Set(["issue", "overdue"]);
  return CRITICAL_HIGH_ALERT_TYPES.has(alertType) ? new Date(Date.now() + REMINDER_DELAY_MS) : null;
}

export default router;
