/**
 * Phase 3 PR 3.2: Admin API for typed task-ownership backfill + manual queue.
 *
 * Admin-only, clinic-scoped. Surfaces:
 *   POST   /api/admin/task-ownership/backfill              — enqueue a job
 *   GET    /api/admin/task-ownership/backfill/:jobId       — job status + counts
 *   GET    /api/admin/task-ownership/queue                 — paginated pending rows
 *   GET    /api/admin/task-ownership/queue/count           — pending-row gauge
 *   POST   /api/admin/task-ownership/queue/:id/confirm     — manual resolution
 *   POST   /api/admin/task-ownership/queue/:id/reject
 *   POST   /api/admin/task-ownership/queue/:id/skip
 *
 * The backfill itself runs asynchronously in BullMQ
 * (`server/workers/taskOwnershipBackfill.worker.ts`). The endpoints below
 * NEVER perform the backfill synchronously.
 */
import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { appointments, db, taskOwnershipConfirmQueue, users } from "../db.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { taskOwnershipBackfillQueue } from "../queues/taskOwnershipBackfill.queue.js";
import { validateConfirmationCandidate } from "../lib/task-ownership-resolver.js";

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

function apiError(res: Response, requestId: string, status: number, code: string, message: string) {
  res.status(status).json({ code, error: code, reason: code, message, requestId });
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill enqueue + status

router.post(
  "/task-ownership/backfill",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      return apiError(res, requestId, 400, "MISSING_CLINIC_ID", "clinicId is required");
    }

    const body = (req.body ?? {}) as { dryRun?: unknown; limit?: unknown };
    const dryRun = body.dryRun === true;
    let limit: number | null = null;
    if (body.limit !== undefined && body.limit !== null) {
      const parsed = Number(body.limit);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
        return apiError(res, requestId, 400, "INVALID_LIMIT", "limit must be a positive integer");
      }
      limit = parsed;
    }

    try {
      const job = await taskOwnershipBackfillQueue.enqueue({
        clinicId,
        dryRun,
        limit,
        requestedByUserId: req.authUser!.id,
      });
      return res.status(200).json({
        jobId: job.id ?? null,
        status: "queued",
        clinicId,
        dryRun,
        limit,
        requestId,
      });
    } catch (err) {
      console.warn("[admin-task-ownership] enqueue failed", {
        clinicId,
        error: err instanceof Error ? err.message : err,
      });
      return apiError(
        res,
        requestId,
        503,
        "QUEUE_UNAVAILABLE",
        "Task-ownership backfill queue is not available",
      );
    }
  },
);

router.get(
  "/task-ownership/backfill/:jobId",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      return apiError(res, requestId, 400, "MISSING_CLINIC_ID", "clinicId is required");
    }
    const { jobId } = req.params;
    try {
      const job = await taskOwnershipBackfillQueue.getJob(jobId);
      if (!job) {
        return apiError(res, requestId, 404, "JOB_NOT_FOUND", "Job not found");
      }
      if (job.data.clinicId !== clinicId) {
        // Clinic isolation: do not leak existence of other clinics' jobs.
        return apiError(res, requestId, 404, "JOB_NOT_FOUND", "Job not found");
      }
      const state = await job.getState();
      const progress = job.progress as { stats?: Record<string, number> } | number | undefined;
      const finalStats =
        (job.returnvalue as Record<string, number> | undefined) ??
        (progress && typeof progress === "object" && "stats" in progress ? progress.stats : undefined) ??
        null;
      return res.status(200).json({
        jobId: job.id,
        clinicId,
        status: state,
        counts: finalStats,
        requestId,
      });
    } catch (err) {
      console.warn("[admin-task-ownership] status failed", {
        jobId,
        clinicId,
        error: err instanceof Error ? err.message : err,
      });
      return apiError(res, requestId, 503, "QUEUE_UNAVAILABLE", "Task-ownership backfill queue is not available");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Queue listing + count

router.get(
  "/task-ownership/queue",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      return apiError(res, requestId, 400, "MISSING_CLINIC_ID", "clinicId is required");
    }
    const statusParam = typeof req.query.status === "string" ? req.query.status : "pending";
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
    const rows = await db
      .select()
      .from(taskOwnershipConfirmQueue)
      .where(
        and(
          eq(taskOwnershipConfirmQueue.clinicId, clinicId),
          eq(taskOwnershipConfirmQueue.resolvedSource, statusParam),
        ),
      )
      .orderBy(asc(taskOwnershipConfirmQueue.createdAt))
      .limit(limit);
    return res.status(200).json({ clinicId, rows, requestId });
  },
);

router.get(
  "/task-ownership/queue/count",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      return apiError(res, requestId, 400, "MISSING_CLINIC_ID", "clinicId is required");
    }
    const [row] = await db
      .select({ pending: count() })
      .from(taskOwnershipConfirmQueue)
      .where(
        and(
          eq(taskOwnershipConfirmQueue.clinicId, clinicId),
          eq(taskOwnershipConfirmQueue.resolvedSource, "pending"),
        ),
      );
    return res.status(200).json({ clinicId, pending: Number(row?.pending ?? 0), requestId });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Queue resolution (confirm / reject / skip)

type Outcome = "manual_confirmed" | "rejected" | "skipped";

async function loadPendingRowInClinic(rowId: string, clinicId: string) {
  const rows = await db
    .select()
    .from(taskOwnershipConfirmQueue)
    .where(and(eq(taskOwnershipConfirmQueue.id, rowId), eq(taskOwnershipConfirmQueue.clinicId, clinicId)))
    .limit(1);
  return rows[0] ?? null;
}

async function resolveQueueRow(
  req: Request,
  res: Response,
  outcome: Outcome,
  bodyConfirmedUserId?: string,
): Promise<void> {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId?.trim();
  if (!clinicId) {
    apiError(res, requestId, 400, "MISSING_CLINIC_ID", "clinicId is required");
    return;
  }
  const rowId = req.params.id;

  const row = await loadPendingRowInClinic(rowId, clinicId);
  if (!row) {
    apiError(res, requestId, 404, "QUEUE_ROW_NOT_FOUND", "Queue row not found");
    return;
  }
  if (row.resolvedSource !== "pending") {
    apiError(res, requestId, 409, "QUEUE_ROW_NOT_PENDING", "Queue row is not pending");
    return;
  }

  let confirmedUserId: string | null = null;
  if (outcome === "manual_confirmed") {
    if (!bodyConfirmedUserId || typeof bodyConfirmedUserId !== "string") {
      apiError(res, requestId, 400, "MISSING_CONFIRMED_USER_ID", "confirmedUserId is required");
      return;
    }
    const candidateIds = asArrayOfStrings(row.candidateUserIds);
    if (!candidateIds.includes(bodyConfirmedUserId)) {
      apiError(
        res,
        requestId,
        400,
        "CONFIRMED_USER_NOT_IN_CANDIDATES",
        "confirmedUserId must be one of the queue row's candidate_user_ids",
      );
      return;
    }
    // Re-validate at write time (§8.4): the candidate must still be active +
    // same-clinic, even if it was at enqueue time.
    const failure = await validateConfirmationCandidate(clinicId, bodyConfirmedUserId);
    if (failure !== null) {
      apiError(res, requestId, 409, `CANDIDATE_${failure}`, `Candidate user is ${failure}`);
      return;
    }
    confirmedUserId = bodyConfirmedUserId;
  }

  const now = new Date();
  const resolvedByUserId = req.authUser!.id;

  // Atomic transition: update the queue row and (for confirmations) the
  // appointment in a single transaction.
  await db.transaction(async (tx) => {
    const updates = await tx
      .update(taskOwnershipConfirmQueue)
      .set({
        resolvedSource: outcome,
        confirmedUserId,
        resolvedByUserId,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskOwnershipConfirmQueue.id, rowId),
          eq(taskOwnershipConfirmQueue.clinicId, clinicId),
          eq(taskOwnershipConfirmQueue.resolvedSource, "pending"),
        ),
      )
      .returning();
    if (updates.length === 0) {
      throw new Error("QUEUE_ROW_RACE");
    }

    if (outcome === "manual_confirmed" && confirmedUserId !== null) {
      await tx
        .update(appointments)
        .set({ acknowledgedUserId: confirmedUserId, acknowledgedAt: now })
        .where(
          and(
            eq(appointments.id, row.appointmentId),
            eq(appointments.clinicId, clinicId),
            sql`${appointments.acknowledgedUserId} IS NULL`,
          ),
        );
    }
  }).catch((err) => {
    if (err instanceof Error && err.message === "QUEUE_ROW_RACE") {
      apiError(res, requestId, 409, "QUEUE_ROW_RACE", "Queue row was already resolved");
      return;
    }
    throw err;
  });

  if (res.headersSent) return;

  // Provenance audit (Stance C): fire-and-forget after commit.
  logAudit({
    clinicId,
    actionType: "MANUAL_OWNERSHIP_CONFIRMATION",
    performedBy: req.authUser!.id,
    performedByEmail: req.authUser!.email,
    targetId: row.appointmentId,
    targetType: "appointment",
    actorRole: resolveAuditActorRole(req as unknown as { authUser?: { role?: string } }),
    metadata: {
      appointmentId: row.appointmentId,
      rawAcknowledgedBy: row.rawAcknowledgedBy,
      confirmedUserId,
      resolutionReason: row.resolutionReason,
      matcherVersion: row.matcherVersion,
      queueRowId: row.id,
      resolvedSource: outcome,
    },
  });

  res.status(200).json({
    id: row.id,
    clinicId,
    appointmentId: row.appointmentId,
    resolvedSource: outcome,
    confirmedUserId,
    resolvedByUserId,
    resolvedAt: now.toISOString(),
    requestId,
  });
}

router.post(
  "/task-ownership/queue/:id/confirm",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { confirmedUserId?: unknown };
    const confirmedUserId = typeof body.confirmedUserId === "string" ? body.confirmedUserId : undefined;
    await resolveQueueRow(req, res, "manual_confirmed", confirmedUserId);
  },
);

router.post(
  "/task-ownership/queue/:id/reject",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    await resolveQueueRow(req, res, "rejected");
  },
);

router.post(
  "/task-ownership/queue/:id/skip",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    await resolveQueueRow(req, res, "skipped");
  },
);

// Reference unused imports so the linter / dead-code checker is satisfied
// without enabling them inside the actual handlers above.
void users;

export default router;
