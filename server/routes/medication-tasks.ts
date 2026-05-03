import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { ensureUserClinicMembership } from "../middleware/ensure-user-clinic-membership.js";
import { canPerformMedicationTaskAction } from "../lib/task-rbac.js";
import {
  createMedicationTask,
  takeMedicationTask,
  completeMedicationTask,
  cancelMedicationTask,
  listMedicationTasks,
  MedTaskError,
  type MedTaskReasonType,
} from "../services/medication-tasks.service.js";
import { MedicationCalculationError, type CalculationResult } from "../services/medication-calculation.service.js";
import type { MedicationTask } from "../db.js";
import { resolveAuditActorRole } from "../lib/audit.js";

const router = Router();

const createTaskSchema = z.object({
  animalId: z.string().trim().min(1),
  drugId: z.string().trim().min(1),
  route: z.string().trim().min(1).max(80),
  calculationInput: z.object({
    weightKg: z.number().finite().positive(),
    prescribedDosePerKg: z.number().finite().positive(),
    doseUnit: z.enum(["mg_per_kg", "mcg_per_kg", "mEq_per_kg", "tablet", "direct_mg"]),
    concentrationMgPerMl: z.number().finite().positive().optional(),
  }),
  overrideReason: z.string().trim().max(1000).optional().nullable(),
  reasonType: z.enum(["NEW", "REPEAT", "CORRECTION"]).optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
});

const completeTaskSchema = z.object({
  actualVolume: z.number().finite().positive(),
  administeredAt: z.string().datetime({ offset: true }).optional().nullable(),
});

const cancelTaskSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

function resolveRequestId(res: Response, incomingHeader: unknown): string {
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

function resolveTaskAuthRole(req: { authUser?: { role?: string }; effectiveRole?: string }): string {
  if (req.authUser?.role === "admin") return "admin";
  return req.effectiveRole ?? req.authUser?.role ?? "";
}

function serializeTask(task: MedicationTask) {
  const rawSnapshot = task.calculationSnapshot as Record<string, unknown> | null;
  const snapshotContainer = rawSnapshot as
    | {
        version?: number;
        weight?: number;
        concentration?: number;
        doseMg?: number;
        calculatedVolume?: number;
        calculationPath?: string;
        formularyId?: string | null;
        formularyVersion?: number | null;
        data?: Partial<CalculationResult>;
      }
    | null;
  const legacySnapshot =
    rawSnapshot && "breakdown" in rawSnapshot && "final" in rawSnapshot && "safety" in rawSnapshot
      ? (rawSnapshot as Partial<CalculationResult>)
      : null;
  const snapshot = snapshotContainer?.data ?? legacySnapshot ?? null;
  const snapshotVersion = snapshotContainer?.data
    ? (snapshotContainer.version ?? 1)
    : legacySnapshot != null
      ? 1
      : null;
  return {
    id: task.id,
    clinicId: task.clinicId,
    animalId: task.animalId,
    drugId: task.drugId,
    route: task.route,
    status: task.status,
    assignedTo: task.assignedTo,
    createdBy: task.createdBy,
    createdAt: task.createdAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    cancelledBy: task.cancelledBy,
    dueAt: task.dueAt?.toISOString() ?? null,
    actualVolume: task.actualVolume !== null ? Number(task.actualVolume) : null,
    administeredAt: task.administeredAt?.toISOString() ?? null,
    inventoryStatus: task.inventoryStatus ?? null,
    inventoryMismatch: task.inventoryMismatch,
    safetyLevel: task.safetyLevel,
    overrideReason: task.overrideReason,
    formularyId: task.formularyId ?? null,
    formularyVersion: task.formularyVersion ?? null,
    calculation: {
      version: snapshotVersion,
      weight: snapshotContainer?.weight ?? null,
      concentration: snapshotContainer?.concentration ?? null,
      doseMg: snapshotContainer?.doseMg ?? null,
      calculatedVolume: snapshotContainer?.calculatedVolume ?? null,
      calculationPath: snapshotContainer?.calculationPath ?? null,
      formularyId: snapshotContainer?.formularyId ?? null,
      formularyVersion: snapshotContainer?.formularyVersion ?? null,
      breakdown: snapshot?.breakdown ?? null,
      final: snapshot?.final ?? null,
      safety: snapshot ? {
        ...snapshot.safety,
        warningMessage: (snapshot as Partial<CalculationResult>).safety?.warningMessage ?? null,
      } : null,
      snapshot: snapshotContainer?.data ? snapshotContainer : legacySnapshot,
    },
  };
}

function sendError(res: Response, err: unknown, requestId: string): void {
  if (err instanceof MedTaskError) {
    res.status(err.status).json({
      ...apiError({
        code: err.code,
        reason: err.code,
        message: err.message,
        requestId,
      }),
      details: err.details ?? null,
    });
    return;
  }

  if (err instanceof MedicationCalculationError) {
    res.status(err.status).json(
      apiError({
        code: err.code,
        reason: err.code,
        message: err.message,
        requestId,
      }),
    );
    return;
  }

  console.error("[medication-tasks] unexpected error", err);
  res.status(500).json(
    apiError({
      code: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Internal error",
      requestId,
    }),
  );
}

router.use(requireAuth, requireEffectiveRole("technician"), ensureUserClinicMembership);

router.post("/", idempotencyMiddleware("medication-tasks:create"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const role = resolveTaskAuthRole(req);
  if (!canPerformMedicationTaskAction(role, "med.task.create")) {
    return res.status(403).json(
      apiError({
        code: "INSUFFICIENT_ROLE",
        reason: "MEDICATION_CREATE_NOT_PERMITTED",
        message: "Only vets may create medication tasks.",
        requestId,
      }),
    );
  }

  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_ERROR",
        reason: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid request body",
        requestId,
      }),
    );
  }

  try {
    const task = await createMedicationTask({
      clinicId: req.clinicId!,
      animalId: parsed.data.animalId,
      drugId: parsed.data.drugId,
      route: parsed.data.route,
      calculationInput: parsed.data.calculationInput,
      overrideReason: parsed.data.overrideReason ?? null,
      reasonType: (parsed.data.reasonType as MedTaskReasonType | null) ?? "NEW",
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      createdBy: req.authUser!.id,
      createdByEmail: req.authUser!.email,
      actorRole: resolveAuditActorRole(req),
    });
    return res.status(201).json(serializeTask(task));
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

router.post("/:id/take", idempotencyMiddleware("medication-tasks:take"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const task = await takeMedicationTask(
      req.params.id,
      req.authUser!.id,
      req.authUser!.email,
      req.clinicId!,
      resolveAuditActorRole(req),
    );
    return res.json(serializeTask(task));
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

router.post("/:id/complete", idempotencyMiddleware("medication-tasks:complete"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  const parsed = completeTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_ERROR",
        reason: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "actualVolume is required",
        requestId,
      }),
    );
  }

  try {
    const task = await completeMedicationTask({
      taskId: req.params.id,
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      clinicId: req.clinicId!,
      actorRole: resolveAuditActorRole(req),
      actualVolume: parsed.data.actualVolume,
      administeredAt: parsed.data.administeredAt ? new Date(parsed.data.administeredAt) : null,
    });
    return res.json(serializeTask(task));
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

router.post("/:id/cancel", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parsed = cancelTaskSchema.safeParse(req.body);
  try {
    const task = await cancelMedicationTask(
      req.params.id,
      req.authUser!.id,
      req.authUser!.email,
      req.clinicId!,
      resolveAuditActorRole(req),
      parsed.success ? (parsed.data.reason ?? null) : null,
    );
    return res.json(serializeTask(task));
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

router.get("/", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const rows = await listMedicationTasks(req.clinicId!);
    return res.json(rows.map(serializeTask));
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

export default router;
