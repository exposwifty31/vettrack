import { Router } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, shiftAdjustments } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { resolveCurrentRole } from "../lib/role-resolution.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import {
  normalizeTime,
  checkAdjustmentDirection,
} from "../lib/shift-adjustment-window.js";

/*
 * Shift-adjustment requests (Phase 1). A rostered person requests to work past
 * their scheduled end (`extend`) or to leave before it (`leave_early`) with a
 * required reason; an admin approves or rejects. Only an `approved` row adjusts
 * the effective shift window in role-resolution (wired separately, additively).
 * The role never changes — an adjustment moves the effective end time only.
 */

const router = Router();

const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;

/** POST /api/shift-adjustments — the current caller requests an extend / leave-early. */
router.post("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const authUser = req.authUser;
  const clinicId = req.clinicId?.trim();
  if (!authUser?.id || !clinicId) {
    return res
      .status(401)
      .json(apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }));
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = body.kind;
  if (kind !== "extend" && kind !== "leave_early") {
    return res
      .status(400)
      .json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_KIND", message: "kind must be 'extend' or 'leave_early'", requestId }));
  }

  const requestedEndTime = normalizeTime(body.requestedEndTime);
  if (!requestedEndTime) {
    return res
      .status(400)
      .json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_TIME", message: "requestedEndTime must be a valid HH:MM time", requestId }));
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    return res
      .status(400)
      .json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_REASON", message: `reason must be ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} characters`, requestId }));
  }

  try {
    // "On shift" is roster-derived — you can only adjust a shift you are on.
    const role = await resolveCurrentRole({
      clinicId,
      userId: authUser.id,
      userName: authUser.name,
      fallbackRole: authUser.role,
      secondaryRole: authUser.secondaryRole ?? null,
    });
    if (role.source !== "shift" || !role.activeShift) {
      return res
        .status(409)
        .json(apiError({ code: "CONFLICT", reason: "NOT_ON_SHIFT", message: "You can only request an adjustment while on a rostered shift", requestId }));
    }

    const shift = role.activeShift;
    const direction = checkAdjustmentDirection(kind, shift.startTime, shift.endTime, requestedEndTime);
    if (!direction.ok) {
      const message =
        direction.reason === "NOT_AN_EXTENSION"
          ? "An extension must end later than the current shift end"
          : "Leaving early must end before the current shift end";
      return res
        .status(400)
        .json(apiError({ code: "VALIDATION_FAILED", reason: direction.reason, message, requestId }));
    }

    // One open request per person per rostered day keeps the admin queue clean.
    const [existing] = await db
      .select({ id: shiftAdjustments.id })
      .from(shiftAdjustments)
      .where(
        and(
          eq(shiftAdjustments.clinicId, clinicId),
          eq(shiftAdjustments.requesterUserId, authUser.id),
          eq(shiftAdjustments.baseShiftDate, shift.date),
          eq(shiftAdjustments.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) {
      return res
        .status(409)
        .json(apiError({ code: "CONFLICT", reason: "DUPLICATE_PENDING", message: "You already have a pending request for this shift", requestId }));
    }

    const id = randomUUID();
    const [created] = await db
      .insert(shiftAdjustments)
      .values({
        id,
        clinicId,
        requesterUserId: authUser.id,
        requesterName: shift.employeeName || authUser.name,
        kind,
        baseShiftDate: shift.date,
        baseShiftId: shift.id,
        currentEndTime: shift.endTime,
        requestedEndTime,
        reason,
        status: "pending",
      })
      .returning();

    logAudit({
      clinicId,
      actionType: "shift_adjustment_requested",
      performedBy: authUser.name || authUser.id,
      performedByEmail: authUser.email ?? "",
      targetId: id,
      targetType: "shift_adjustment",
      metadata: { kind, baseShiftDate: shift.date, currentEndTime: shift.endTime, requestedEndTime },
      actorRole: resolveAuditActorRole(req),
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("shift-adjustments:create", err);
    return res
      .status(500)
      .json(apiError({ code: "INTERNAL_ERROR", reason: "CREATE_FAILED", message: "Failed to create request", requestId }));
  }
});

/** GET /api/shift-adjustments?status= — admin sees all; a requester sees their own. */
router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const authUser = req.authUser;
  const clinicId = req.clinicId?.trim();
  if (!authUser?.id || !clinicId) {
    return res
      .status(401)
      .json(apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }));
  }

  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const validStatuses = ["pending", "approved", "rejected", "cancelled"] as const;
  const statusFilter = validStatuses.find((s) => s === statusParam);

  const isAdmin = authUser.role === "admin" || authUser.secondaryRole === "admin";

  try {
    const filters = [eq(shiftAdjustments.clinicId, clinicId)];
    if (!isAdmin) filters.push(eq(shiftAdjustments.requesterUserId, authUser.id));
    if (statusFilter) filters.push(eq(shiftAdjustments.status, statusFilter));

    const rows = await db
      .select()
      .from(shiftAdjustments)
      .where(and(...filters))
      .orderBy(desc(shiftAdjustments.createdAt))
      .limit(200);

    return res.json({ requests: rows });
  } catch (err) {
    console.error("shift-adjustments:list", err);
    return res
      .status(500)
      .json(apiError({ code: "INTERNAL_ERROR", reason: "LIST_FAILED", message: "Failed to list requests", requestId }));
  }
});

/** PATCH /api/shift-adjustments/:id — admin approves or rejects a pending request. */
router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const authUser = req.authUser;
  const clinicId = req.clinicId?.trim();
  if (!authUser?.id || !clinicId) {
    return res
      .status(401)
      .json(apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }));
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return res
      .status(400)
      .json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_DECISION", message: "decision must be 'approved' or 'rejected'", requestId }));
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_REASON_LENGTH) : null;

  try {
    const [existing] = await db
      .select()
      .from(shiftAdjustments)
      .where(and(eq(shiftAdjustments.id, req.params.id), eq(shiftAdjustments.clinicId, clinicId)))
      .limit(1);
    if (!existing) {
      return res
        .status(404)
        .json(apiError({ code: "NOT_FOUND", reason: "REQUEST_NOT_FOUND", message: "Request not found", requestId }));
    }
    if (existing.status !== "pending") {
      return res
        .status(409)
        .json(apiError({ code: "CONFLICT", reason: "ALREADY_DECIDED", message: `Request is already ${existing.status}`, requestId }));
    }

    const [updated] = await db
      .update(shiftAdjustments)
      .set({ status: decision, decidedByUserId: authUser.id, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(shiftAdjustments.id, existing.id), eq(shiftAdjustments.status, "pending")))
      .returning();

    if (!updated) {
      return res
        .status(409)
        .json(apiError({ code: "CONFLICT", reason: "ALREADY_DECIDED", message: "Request was decided concurrently", requestId }));
    }

    logAudit({
      clinicId,
      actionType: decision === "approved" ? "shift_adjustment_approved" : "shift_adjustment_rejected",
      performedBy: authUser.name || authUser.id,
      performedByEmail: authUser.email ?? "",
      targetId: updated.id,
      targetType: "shift_adjustment",
      metadata: {
        kind: updated.kind,
        requesterUserId: updated.requesterUserId,
        requestedEndTime: updated.requestedEndTime,
        note,
      },
      actorRole: resolveAuditActorRole(req),
    });

    return res.json(updated);
  } catch (err) {
    console.error("shift-adjustments:decide", err);
    return res
      .status(500)
      .json(apiError({ code: "INTERNAL_ERROR", reason: "DECIDE_FAILED", message: "Failed to decide request", requestId }));
  }
});

/** POST /api/shift-adjustments/:id/cancel — a requester cancels their own pending request. */
router.post("/:id/cancel", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const authUser = req.authUser;
  const clinicId = req.clinicId?.trim();
  if (!authUser?.id || !clinicId) {
    return res
      .status(401)
      .json(apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }));
  }

  try {
    const [existing] = await db
      .select()
      .from(shiftAdjustments)
      .where(and(eq(shiftAdjustments.id, req.params.id), eq(shiftAdjustments.clinicId, clinicId)))
      .limit(1);
    if (!existing) {
      return res
        .status(404)
        .json(apiError({ code: "NOT_FOUND", reason: "REQUEST_NOT_FOUND", message: "Request not found", requestId }));
    }
    if (existing.requesterUserId !== authUser.id) {
      return res
        .status(403)
        .json(apiError({ code: "FORBIDDEN", reason: "NOT_OWNER", message: "You can only cancel your own request", requestId }));
    }
    if (existing.status !== "pending") {
      return res
        .status(409)
        .json(apiError({ code: "CONFLICT", reason: "ALREADY_DECIDED", message: `Request is already ${existing.status}`, requestId }));
    }

    const [updated] = await db
      .update(shiftAdjustments)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(and(eq(shiftAdjustments.id, existing.id), eq(shiftAdjustments.status, "pending")))
      .returning();

    logAudit({
      clinicId,
      actionType: "shift_adjustment_cancelled",
      performedBy: authUser.name || authUser.id,
      performedByEmail: authUser.email ?? "",
      targetId: existing.id,
      targetType: "shift_adjustment",
      metadata: { kind: existing.kind },
      actorRole: resolveAuditActorRole(req),
    });

    return res.json(updated ?? existing);
  } catch (err) {
    console.error("shift-adjustments:cancel", err);
    return res
      .status(500)
      .json(apiError({ code: "INTERNAL_ERROR", reason: "CANCEL_FAILED", message: "Failed to cancel request", requestId }));
  }
});

export default router;
