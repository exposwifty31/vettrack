import { Router, type Response } from "express";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import {
  AppointmentServiceError,
  completeTask,
  getActiveTasks,
  getTasksForTechnicianToday,
  startTask,
} from "../services/appointments.service.js";
import { getTaskRecommendations } from "../services/task-intelligence.service.js";
import { getTaskDashboard } from "../services/task-recall.service.js";
import { canPerformTaskAction, type TaskAction } from "../lib/task-rbac.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();

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
  if (!requireTaskActionPermission(req, res, "task.start")) return;
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
  if (!requireTaskActionPermission(req, res, "task.complete")) return;
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
    const { task } = await completeTask(req.clinicId!, req.params.id, {
      userId: req.authUser.id,
      clerkId: req.authUser.clerkId,
      email: req.authUser.email,
      role: resolveTaskAuthRole(req),
    });
    return res.json({ task });
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
