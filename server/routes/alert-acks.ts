import { Router } from "express";
import { randomUUID } from "crypto";
import { db, alertAcks, equipment } from "../db.js";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { sendPushToOthers, checkDedupe } from "../lib/push.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

/*
 * PERMISSIONS MATRIX — /api/alert-acks
 * ─────────────────────────────────────────────────────
 * GET  /             student+      Read current acknowledgments
 * POST /             technician+   Mark alert as SEEN ("I've seen this")
 * PATCH /:id/resolve technician+   Mark alert as RESOLVED (intent to close)
 * ─────────────────────────────────────────────────────
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

function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

// GET /api/alert-acks — return all current acknowledgments (not resolved unless asked)
router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const includeResolved = req.query.includeResolved === "true";

    const rows = await db
      .select()
      .from(alertAcks)
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

// POST /api/alert-acks — mark alert as SEEN ("I've seen this") — technician+ only
// SEEN does NOT stop escalation. System continues to remind.
router.post("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
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
      .select()
      .from(alertAcks)
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
        const [updated] = await db.select().from(alertAcks).where(eq(alertAcks.id, existing.id)).limit(1);
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

    res.status(201).json(ack);

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
router.patch("/:id/resolve", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const ackId = req.params.id;
    const resolutionNote = typeof req.body?.resolutionNote === "string" ? req.body.resolutionNote.trim() : null;

    const [existing] = await db
      .select()
      .from(alertAcks)
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

    const [updated] = await db.select().from(alertAcks).where(eq(alertAcks.id, ackId)).limit(1);

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
