import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { getAuth } from "@clerk/express";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import {
  AppointmentServiceError,
  completeTask,
  getActiveMedicationTasks,
  getActiveTasks,
  getTasksForTechnicianToday,
  type MedicationExecutionInput,
  startTask,
  vetApproveTask,
} from "../services/appointments.service.js";
import { getTaskRecommendations } from "../services/task-intelligence.service.js";
import { getTaskDashboard } from "../services/task-recall.service.js";
import {
  canPerformMedicationTaskAction,
  canPerformTaskAction,
  type MedicationTaskAction,
  type TaskAction,
} from "../lib/task-rbac.js";

const router = Router();

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

function apiError(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
  details?: unknown;
}) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
    ...(params.details !== undefined ? { details: params.details } : {}),
  };
}

function sendServiceError(res: Response, err: unknown, requestId: string) {
  if (err instanceof AppointmentServiceError) {
    res.status(err.status).json({
      code: err.code,
      error: err.code,
      reason: err.code,
      message: err.message,
      requestId,
      details: err.details ?? null,
    });
    return true;
  }
  return false;
}

function resolveTaskAuthRole(req: { authUser?: { role?: string }; effectiveRole?: string }): string {
  if (req.authUser?.role === "admin") return "admin";
  return req.effectiveRole ?? req.authUser?.role ?? "";
}

function requireTaskActionPermission(
  req: { authUser?: { role?: string }; effectiveRole?: string },
  res: Response,
  action: TaskAction,
): boolean {
  const role = resolveTaskAuthRole(req);
  if (canPerformTaskAction(role, action)) return true;
  const requestId = resolveRequestId(res, null);
  res.status(403).json(
    apiError({
      code: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_ROLE",
      message: "Insufficient task permissions",
      requestId,
    }),
  );
  return false;
}

function requireTaskOrMedicationActionPermission(
  req: { authUser?: { role?: string }; effectiveRole?: string },
  res: Response,
  taskAction: TaskAction,
  medicationAction: MedicationTaskAction,
): boolean {
  const role = resolveTaskAuthRole(req);
  if (canPerformTaskAction(role, taskAction) || canPerformMedicationTaskAction(role, medicationAction)) return true;
  const requestId = resolveRequestId(res, null);
  res.status(403).json(
    apiError({
      code: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_ROLE",
      message: "Insufficient task permissions",
      requestId,
    }),
  );
  return false;
}

function normalizeMedicationExecutionPayload(input: unknown): MedicationExecutionInput | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const execution: MedicationExecutionInput = {};
  const asFinite = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const weightKg = asFinite(record.weightKg);
  const prescribedDosePerKg = asFinite(record.prescribedDosePerKg);
  const concentrationMgPerMl = asFinite(record.concentrationMgPerMl);
  const formularyConcentrationMgPerMl = asFinite(record.formularyConcentrationMgPerMl);
  const convertedDoseMgPerKg = asFinite(record.convertedDoseMgPerKg);
  const calculatedVolumeMl = asFinite(record.calculatedVolumeMl);
  if (weightKg !== undefined) execution.weightKg = weightKg;
  if (prescribedDosePerKg !== undefined) execution.prescribedDosePerKg = prescribedDosePerKg;
  if (concentrationMgPerMl !== undefined) execution.concentrationMgPerMl = concentrationMgPerMl;
  if (formularyConcentrationMgPerMl !== undefined) {
    execution.formularyConcentrationMgPerMl = formularyConcentrationMgPerMl;
  }
  if (convertedDoseMgPerKg !== undefined) execution.convertedDoseMgPerKg = convertedDoseMgPerKg;
  if (calculatedVolumeMl !== undefined) execution.calculatedVolumeMl = calculatedVolumeMl;

  if (record.doseUnit === "mg_per_kg" || record.doseUnit === "mcg_per_kg") {
    execution.doseUnit = record.doseUnit;
  }
  if (typeof record.concentrationOverridden === "boolean") {
    execution.concentrationOverridden = record.concentrationOverridden;
  }

  return Object.keys(execution).length > 0 ? execution : undefined;
}

router.post(
  "/:id/vet-approve",
  requireAuth,
  requireEffectiveRole("vet"),
  idempotencyMiddleware("tasks:vet-approve"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!req.params.id?.trim()) {
    return res.status(400).json(
      apiError({ code: "VALIDATION_FAILED", reason: "MISSING_ID_PARAM", message: "id param is required", requestId }),
    );
  }
  if (!req.authUser) {
    return res.status(401).json(
      apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Authentication required", requestId }),
    );
  }
  try {
    const task = await vetApproveTask(req.clinicId!, req.params.id, {
      userId: req.authUser.id,
      clerkId: req.authUser.clerkId,
      email: req.authUser.email,
      role: resolveTaskAuthRole(req),
    });
    return res.json({ task });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("tasks:vet-approve", err);
    return res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "TASK_APPROVE_FAILED", message: "Failed to approve task", requestId }),
    );
  }
});

router.get("/dashboard", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskActionPermission(req, res, "task.read")) return;
  if (!req.authUser) {
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Authentication required",
        requestId,
      }),
    );
  }
  const clinicId = req.clinicId;
  if (!clinicId?.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      }),
    );
  }
  try {
    const dashboard = await getTaskDashboard(clinicId, req.authUser.id);
    return res.json(dashboard);
  } catch (err) {
    console.error("tasks:dashboard", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "TASK_DASHBOARD_FAILED",
        message: "Failed to load task dashboard",
        requestId,
      }),
    );
  }
});

router.post(
  "/:id/start",
  requireAuth,
  requireEffectiveRole("technician"),
  idempotencyMiddleware("tasks:start"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskOrMedicationActionPermission(req, res, "task.start", "med.start")) return;
  if (!req.params.id?.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_ID_PARAM",
        message: "id param is required",
        requestId,
      }),
    );
  }
  if (!req.authUser) {
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Authentication required",
        requestId,
      }),
    );
  }
  try {
    const task = await startTask(req.clinicId!, req.params.id, {
      userId: req.authUser.id,
      clerkId: req.authUser.clerkId,
      email: req.authUser.email,
      role: resolveTaskAuthRole(req),
    });
    return res.json({ task });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("tasks:start", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "TASK_START_FAILED",
        message: "Failed to start task",
        requestId,
      }),
    );
  }
});

router.post(
  "/:id/complete",
  requireAuth,
  requireEffectiveRole("technician"),
  idempotencyMiddleware("tasks:complete"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskOrMedicationActionPermission(req, res, "task.complete", "med.complete")) return;
  if (!req.params.id?.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_ID_PARAM",
        message: "id param is required",
        requestId,
      }),
    );
  }
  if (!req.authUser) {
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Authentication required",
        requestId,
      }),
    );
  }
  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const executionPayload = normalizeMedicationExecutionPayload(
      (body.execution as unknown) ?? body,
    );
    const { task, inventoryEnqueueFailed } = await completeTask(req.clinicId!, req.params.id, {
      userId: req.authUser.id,
      clerkId: req.authUser.clerkId,
      email: req.authUser.email,
      role: resolveTaskAuthRole(req),
    }, executionPayload);
    return res.json({ task, inventoryWarning: inventoryEnqueueFailed });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("tasks:complete", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "TASK_COMPLETE_FAILED",
        message: "Failed to complete task",
        requestId,
      }),
    );
  }
});

router.get("/me", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskActionPermission(req, res, "task.read")) return;
  if (!req.authUser) {
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Authentication required",
        requestId,
      }),
    );
  }
  try {
    const tasks = await getTasksForTechnicianToday(req.clinicId!, req.authUser.id);
    return res.json({ tasks });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("tasks:me", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "TASKS_LOAD_FAILED",
        message: "Failed to load tasks",
        requestId,
      }),
    );
  }
});

router.get("/active", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskActionPermission(req, res, "task.read")) return;
  try {
    const tasks = await getActiveTasks(req.clinicId!);
    return res.json({ tasks });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("tasks:active", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ACTIVE_TASKS_LOAD_FAILED",
        message: "Failed to load active tasks",
        requestId,
      }),
    );
  }
});

router.get("/medication-active", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  if (!requireTaskOrMedicationActionPermission(req, res, "task.read", "med.read")) return;

  let userId: string | null | undefined;
  let orgId: string | null | undefined;

  try {
    const auth = getAuth(req);
    userId = auth.userId;
    orgId = auth.orgId;
  } catch {
    userId = req.authUser?.id;
    orgId = req.clinicId;
  }

  const resolvedAuthUserId = req.authUser?.id ?? userId;

  if (!resolvedAuthUserId) {
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Unauthorized",
        requestId,
      }),
    );
  }

  const clinicId = req.clinicId?.trim();

  if (!clinicId) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      }),
    );
  }

  const clerkAuthEnabled =
    Boolean(process.env.CLERK_SECRET_KEY?.trim()) &&
    process.env.CLERK_ENABLED !== "false";

  const resolvedOrgId = orgId ?? req.authUser?.clinicId ?? clinicId;

  if (clerkAuthEnabled && !resolvedOrgId) {
    return res.status(403).json(
      apiError({
        code: "FORBIDDEN",
        reason: "MISSING_ORG_ID",
        message: "Missing organization context",
        requestId,
      }),
    );
  }

  if (resolvedOrgId && clinicId !== resolvedOrgId) {
    return res.status(403).json(
      apiError({
        code: "FORBIDDEN",
        reason: "TENANT_MISMATCH",
        message: "Authenticated organization does not match clinic context",
        requestId,
      }),
    );
  }

  try {
    const tasks = await getActiveMedicationTasks(clinicId);
    return res.json({ tasks });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;

    console.error("MEDICATION_ACTIVE_ERROR:", err);

    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "MEDICATION_ACTIVE_TASKS_LOAD_FAILED",
        message: "Failed to load medication execution tasks",
        requestId,
      }),
    );
  }
});

router.get("/recommendations", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskActionPermission(req, res, "task.read")) return;
  if (!req.authUser) {
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Authentication required",
        requestId,
      }),
    );
  }
  const clinicId = req.clinicId;
  if (!clinicId?.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      }),
    );
  }
  try {
    const data = await getTaskRecommendations(clinicId, req.authUser.id);
    return res.json(data);
  } catch (err) {
    console.error("tasks:recommendations", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "TASK_RECOMMENDATIONS_FAILED",
        message: "Failed to load recommendations",
        requestId,
      }),
    );
  }
});

export default router;
