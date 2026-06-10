import { Router, type Response } from "express";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, shifts, users } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { toServiceTask, type AppointmentLike } from "../domain/service-task.adapter.js";
import { isServiceTaskModeForUser } from "../lib/feature-flags.js";
import { logServiceChange } from "../lib/service-change-log.js";
import { canPerformTaskAction, type TaskAction } from "../lib/task-rbac.js";
import {
  AppointmentServiceError,
  cancelAppointment,
  createAppointment,
  getAppointmentsByDay,
  getAppointmentsByVet,
  listAppointmentsByRange,
  updateAppointment,
} from "../services/appointments.service.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
const router = Router();

const statusSchema = z.enum([
  "pending",
  "assigned",
  "scheduled",
  "arrived",
  "approved",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);
const prioritySchema = z.enum(["critical", "high", "normal"]);
const taskTypeSchema = z.enum(["maintenance", "repair", "inspection"]);
const metadataSchema = z.record(z.unknown()).optional().nullable();

const createAppointmentSchema = z.object({
  animalId: z.string().trim().min(1).optional().nullable(),
  ownerId: z.string().trim().min(1).optional().nullable(),
  vetId: z.string().trim().optional().nullable(),
  startTime: z.string().trim().min(1, "startTime is required"),
  endTime: z.string().trim().min(1, "endTime is required"),
  scheduledAt: z.string().trim().min(1).optional().nullable(),
  status: statusSchema.optional(),
  conflictOverride: z.boolean().optional(),
  overrideReason: z.string().max(4000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  priority: prioritySchema.optional(),
  taskType: taskTypeSchema.optional().nullable(),
  metadata: metadataSchema,
  hospitalizationId: z.string().trim().min(1).optional().nullable(),
  appointmentType: z.string().trim().max(40).optional().nullable(),
});

const updateAppointmentSchema = z
  .object({
    animalId: z.string().trim().min(1).optional().nullable(),
    ownerId: z.string().trim().min(1).optional().nullable(),
    vetId: z.string().trim().optional().nullable(),
    startTime: z.string().trim().min(1).optional(),
    endTime: z.string().trim().min(1).optional(),
    scheduledAt: z.string().trim().min(1).optional().nullable(),
    status: statusSchema.optional(),
    conflictOverride: z.boolean().optional(),
    overrideReason: z.string().max(4000).optional().nullable(),
    notes: z.string().max(4000).optional().nullable(),
    priority: prioritySchema.optional(),
    taskType: taskTypeSchema.optional().nullable(),
    metadata: metadataSchema,
    hospitalizationId: z.string().trim().min(1).optional().nullable(),
    appointmentType: z.string().trim().max(40).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

const deleteAppointmentSchema = z.object({
  reason: z.string().max(4000).optional(),
});

const listQuerySchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    vetId: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.day) return;
    if (!data.start || !data.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either day=YYYY-MM-DD or both start/end in UTC format",
      });
    }
  });

const metaQuerySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

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

router.post(
  "/",
  requireAuth,
  requireEffectiveRole("technician"),
  idempotencyMiddleware("appointments:create"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parsed = createAppointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "INVALID_REQUEST_BODY",
      message: "Invalid request body",
      requestId,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (!requireTaskActionPermission(req, res, "task.create")) {
    return;
  }
  if (parsed.data.vetId?.trim() && !requireTaskActionPermission(req, res, "task.assign")) {
    return;
  }

  try {
    const appointment = await createAppointment(
      req.clinicId!,
      parsed.data,
      req.authUser
        ? {
            userId: req.authUser.id,
            clerkId: req.authUser.clerkId,
            email: req.authUser.email,
            role: resolveTaskAuthRole(req),
          }
        : undefined,
    );
    const uid = req.authUser?.id;
    if (uid && isServiceTaskModeForUser(uid)) {
      logServiceChange("appointment_created", {
        userId: uid,
        clinicId: req.clinicId,
        appointmentId: appointment.id,
        serviceTask: toServiceTask(appointment as AppointmentLike),
      });
    }
    return res.status(201).json({ appointment });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("appointments:create", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "APPOINTMENT_CREATE_FAILED",
        message: "Failed to create appointment",
        requestId,
      }),
    );
  }
});

router.get("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskActionPermission(req, res, "task.read")) {
    return;
  }
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "INVALID_QUERY_PARAMS",
      message: "Invalid query params",
      requestId,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const clinicId = req.clinicId!;
    const { day, start, end, vetId } = parsed.data;

    const appointments = day
      ? await getAppointmentsByDay(clinicId, day)
      : vetId
        ? await getAppointmentsByVet(clinicId, vetId, start!, end!)
        : await listAppointmentsByRange(clinicId, start!, end!);

    return res.json({ appointments });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("appointments:list", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "APPOINTMENTS_LIST_FAILED",
        message: "Failed to list appointments",
        requestId,
      }),
    );
  }
});

router.get("/meta", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!requireTaskActionPermission(req, res, "task.read")) {
    return;
  }
  const parsed = metaQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "INVALID_QUERY_PARAMS",
      message: "Invalid query params",
      requestId,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const clinicId = req.clinicId!;
    const day = parsed.data.day;

    const clinicVets = await db
      .select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          isNull(users.deletedAt),
          eq(users.role, "vet"),
        ),
      )
      .orderBy(users.displayName, users.name);

    const clinicTechnicians = await db
      .select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          isNull(users.deletedAt),
          or(
            eq(users.role, "technician"),
            eq(users.role, "senior_technician"),
            eq(users.secondaryRole, "technician"),
            eq(users.secondaryRole, "senior_technician"),
          ),
        ),
      )
      .orderBy(users.displayName, users.name);

    const dayShifts = await db
      .select({
        id: shifts.id,
        employeeName: shifts.employeeName,
        startTime: shifts.startTime,
        endTime: shifts.endTime,
        role: shifts.role,
      })
      .from(shifts)
      .where(and(eq(shifts.clinicId, clinicId), eq(shifts.date, day)))
      .orderBy(shifts.startTime, shifts.employeeName);

    const vets = clinicVets.map((vet) => {
      const names = [vet.displayName?.trim() ?? "", vet.name?.trim() ?? ""].filter(Boolean);
      const vetShifts = dayShifts.filter((shift) => names.includes(shift.employeeName));
      return {
        ...vet,
        shifts: vetShifts,
      };
    });

    const technicians = clinicTechnicians.map((tech) => {
      const names = [tech.displayName?.trim() ?? "", tech.name?.trim() ?? ""].filter(Boolean);
      const techShifts = dayShifts.filter((shift) => names.includes(shift.employeeName));
      return {
        ...tech,
        shifts: techShifts,
      };
    });

    return res.json({ day, vets, technicians });
  } catch (err) {
    console.error("appointments:meta", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "APPOINTMENTS_META_FAILED",
        message: "Failed to load scheduling metadata",
        requestId,
      }),
    );
  }
});

router.patch(
  "/:id",
  requireAuth,
  requireEffectiveRole("technician"),
  idempotencyMiddleware("appointments:update"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!req.params.id || !req.params.id.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_ID_PARAM",
        message: "id param is required",
        requestId,
      }),
    );
  }

  if (!requireTaskActionPermission(req, res, "task.create")) {
    return;
  }

  const parsed = updateAppointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "INVALID_REQUEST_BODY",
      message: "Invalid request body",
      requestId,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (parsed.data.vetId !== undefined && !requireTaskActionPermission(req, res, "task.reassign")) {
    return;
  }

  if (parsed.data.status === "cancelled" && !requireTaskActionPermission(req, res, "task.cancel")) {
    return;
  }

  try {
    const appointment = await updateAppointment(
      req.clinicId!,
      req.params.id,
      parsed.data,
      req.authUser
        ? {
            userId: req.authUser.id,
            clerkId: req.authUser.clerkId,
            email: req.authUser.email,
            role: resolveTaskAuthRole(req),
          }
        : undefined,
    );
    const uid = req.authUser?.id;
    if (uid && isServiceTaskModeForUser(uid)) {
      logServiceChange("appointment_updated", {
        userId: uid,
        clinicId: req.clinicId,
        appointmentId: appointment.id,
        serviceTask: toServiceTask(appointment as AppointmentLike),
      });
    }
    return res.json({ appointment });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("appointments:update", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "APPOINTMENT_UPDATE_FAILED",
        message: "Failed to update appointment",
        requestId,
      }),
    );
  }
});

router.delete("/:id", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!req.params.id || !req.params.id.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_ID_PARAM",
        message: "id param is required",
        requestId,
      }),
    );
  }

  if (!requireTaskActionPermission(req, res, "task.cancel")) {
    return;
  }

  const parsed = deleteAppointmentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "INVALID_REQUEST_BODY",
      message: "Invalid request body",
      requestId,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const appointment = await cancelAppointment(
      req.clinicId!,
      req.params.id,
      parsed.data.reason,
      req.authUser
        ? {
            userId: req.authUser.id,
            clerkId: req.authUser.clerkId,
            email: req.authUser.email,
            role: resolveTaskAuthRole(req),
          }
        : undefined,
    );
    const uid = req.authUser?.id;
    if (uid && isServiceTaskModeForUser(uid)) {
      logServiceChange("appointment_cancelled", {
        userId: uid,
        clinicId: req.clinicId,
        appointmentId: appointment.id,
        serviceTask: toServiceTask(appointment as AppointmentLike),
      });
    }
    return res.json({ appointment });
  } catch (err) {
    if (sendServiceError(res, err, requestId)) return;
    console.error("appointments:cancel", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "APPOINTMENT_CANCEL_FAILED",
        message: "Failed to cancel appointment",
        requestId,
      }),
    );
  }
});

export default router;
