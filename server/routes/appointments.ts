import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { appointments, db, shifts, users } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { toServiceTask, type AppointmentLike } from "../domain/service-task.adapter.js";
import { isServiceTaskModeForUser } from "../lib/feature-flags.js";
import { logServiceChange } from "../lib/service-change-log.js";
import {
  canPerformMedicationTaskAction,
  canPerformTaskAction,
  type MedicationTaskAction,
  type TaskAction,
} from "../lib/task-rbac.js";
import {
  AppointmentServiceError,
  cancelAppointment,
  createAppointment,
  getAppointmentsByDay,
  getAppointmentsByVet,
  listAppointmentsByRange,
  updateAppointment,
} from "../services/appointments.service.js";
import {
  buildMedicationIdempotencyKey,
  CALC_MISMATCH_TOLERANCE_PERCENT,
  CALCULATION_VERSION,
  MEDICATION_IDEMPOTENCY_LOOKBACK_MS,
  percentDiff,
  recalculateMedicationPayload,
} from "../lib/medication-calculator-hardening.js";

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
const taskTypeSchema = z.enum(["maintenance", "repair", "inspection", "medication"]);
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

function requireMedicationActionPermission(
  req: { authUser?: { role?: string }; effectiveRole?: string },
  res: Response,
  action: MedicationTaskAction,
): boolean {
  const role = resolveTaskAuthRole(req);
  if (canPerformMedicationTaskAction(role, action)) return true;
  const requestId = resolveRequestId(res, null);
  res.status(403).json(
    apiError({
      code: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_ROLE",
      message: "Insufficient medication task permissions",
      requestId,
    }),
  );
  return false;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readPositiveWeightKgFromMetadata(metadata: Record<string, unknown>): number | null {
  const raw = metadata.weightKg;
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

  const role = resolveTaskAuthRole(req);
  const source = (() => {
    const metadata = metadataRecord(parsed.data.metadata);
    return typeof metadata.source === "string" ? metadata.source.trim().toLowerCase() : "";
  })();
  const isCalculatorSourceMedication = parsed.data.taskType === "medication" && source === "calculator";

  if (parsed.data.taskType === "medication") {
    // Clinical policy: medication task creation is veterinarian-only.
    const canInitiateMedication = role === "vet";
    if (!canInitiateMedication) {
      return res.status(403).json(
        apiError({
          code: "INSUFFICIENT_ROLE",
          reason: "MEDICATION_CREATE_NOT_PERMITTED",
          message: "Only vets may create medication tasks.",
          requestId,
        }),
      );
    }
    if (!requireMedicationActionPermission(req, res, "med.task.create")) {
      return;
    }
  } else {
    if (!requireTaskActionPermission(req, res, "task.create")) {
      return;
    }
    if (parsed.data.vetId?.trim() && !requireTaskActionPermission(req, res, "task.assign")) {
      return;
    }
  }

  try {
    if (parsed.data.taskType === "medication") {
      const weightKg = readPositiveWeightKgFromMetadata(metadataRecord(parsed.data.metadata));
      if (weightKg == null) {
        return res.status(400).json(
          apiError({
            code: "VALIDATION_FAILED",
            reason: "MEDICATION_WEIGHT_REQUIRED",
            message: "Patient Weight (kg) is required for medication tasks.",
            requestId,
          }),
        );
      }
    }

    let payload = parsed.data;

    if (isCalculatorSourceMedication) {
      const metadata = metadataRecord(parsed.data.metadata);
      const drugNameRaw = metadata.drugName ?? metadata.medicationName ?? parsed.data.notes ?? "";
      const drugName = typeof drugNameRaw === "string" ? drugNameRaw.trim() : "";
      const weightKg = typeof metadata.weightKg === "number" ? metadata.weightKg : Number.NaN;
      const chosenDoseMgPerKgRaw =
        typeof metadata.chosenDoseMgPerKg === "number"
          ? metadata.chosenDoseMgPerKg
          : typeof metadata.doseMgPerKg === "number"
            ? metadata.doseMgPerKg
            : Number.NaN;
      const concentrationMgPerMl =
        typeof metadata.concentrationMgPerMl === "number" ? metadata.concentrationMgPerMl : Number.NaN;
      const recommendedDoseMgPerKg =
        typeof metadata.recommendedDoseMgPerKg === "number"
          ? metadata.recommendedDoseMgPerKg
          : typeof metadata.defaultDoseMgPerKg === "number"
            ? metadata.defaultDoseMgPerKg
            : null;
      const doseUnit =
        metadata.doseUnit === "mcg_per_kg" || metadata.doseUnit === "mg_per_kg"
          ? metadata.doseUnit
          : "mg_per_kg";

      if (!drugName || !Number.isFinite(weightKg) || !Number.isFinite(chosenDoseMgPerKgRaw) || !Number.isFinite(concentrationMgPerMl)) {
        return res.status(400).json(
          apiError({
            code: "VALIDATION_FAILED",
            reason: "INVALID_CALCULATOR_METADATA",
            message: "Calculator medication metadata is missing required fields.",
            requestId,
          }),
        );
      }

      const recalculated = recalculateMedicationPayload({
        weightKg,
        chosenDosePerKg: chosenDoseMgPerKgRaw,
        concentrationMgPerMl,
        recommendedDosePerKg: recommendedDoseMgPerKg,
        doseUnit,
      });
      if (!recalculated) {
        return res.status(422).json(
          apiError({
            code: "CALCULATION_FAILED",
            reason: "INVALID_CALCULATION_INPUT",
            message: "Server calculation failed for medication payload.",
            requestId,
          }),
        );
      }
      if (recalculated.volumeMl > 100) {
        return res.status(422).json(
          apiError({
            code: "CALCULATION_FAILED",
            reason: "VOLUME_EXCEEDS_100ML",
            message: "Calculated medication volume exceeds 100 mL safety threshold.",
            requestId,
          }),
        );
      }
      if (
        recalculated.deviationPercent !== null
        && Number.isFinite(recalculated.deviationPercent)
        && Math.abs(recalculated.deviationPercent) > 50
      ) {
        return res.status(403).json(
          apiError({
            code: "DOSE_DEVIATION_EXCEEDS_CAP",
            reason: "DOSE_DEVIATION_EXCEEDS_CAP",
            message: "Dose deviation above 50% is blocked by clinical policy.",
            requestId,
          }),
        );
      }

      const idempotencyKey = buildMedicationIdempotencyKey({
        userId: req.authUser!.id,
        drugName,
        weightKg,
        chosenDoseMgPerKg: recalculated.normalizedDoseMgPerKg,
      });
      const cutoff = new Date(Date.now() - MEDICATION_IDEMPOTENCY_LOOKBACK_MS);
      const existing = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, req.clinicId!),
            eq(appointments.taskType, "medication"),
            gte(appointments.createdAt, cutoff),
            sql`${appointments.metadata} ->> 'idempotencyKey' = ${idempotencyKey}`,
          ),
        )
        .orderBy(desc(appointments.createdAt))
        .limit(1);

      if (existing[0]) {
        return res.status(200).json({ appointment: existing[0], idempotent: true });
      }

      const clientTotalMg = typeof metadata.totalMg === "number" ? metadata.totalMg : null;
      const clientVolumeMl = typeof metadata.volumeMl === "number" ? metadata.volumeMl : null;
      const clientDeviation = typeof metadata.deviationPercent === "number" ? metadata.deviationPercent : null;
      const totalMgMismatch =
        clientTotalMg !== null
          ? percentDiff(recalculated.totalMg, clientTotalMg) > CALC_MISMATCH_TOLERANCE_PERCENT
          : false;
      const volumeMismatch =
        clientVolumeMl !== null
          ? percentDiff(recalculated.volumeMl, clientVolumeMl) > CALC_MISMATCH_TOLERANCE_PERCENT
          : false;
      const deviationMismatch =
        clientDeviation !== null && recalculated.deviationPercent !== null
          ? percentDiff(recalculated.deviationPercent, clientDeviation) > CALC_MISMATCH_TOLERANCE_PERCENT
          : false;
      if (totalMgMismatch || volumeMismatch || deviationMismatch) {
        return res.status(422).json(
          apiError({
            code: "CALCULATION_MISMATCH",
            reason: "CLIENT_SERVER_MISMATCH",
            message: "Submitted medication values do not match trusted server calculations.",
            requestId,
            details: {
              totalMg: recalculated.totalMg,
              volumeMl: recalculated.volumeMl,
              deviationPercent: recalculated.deviationPercent,
            },
          }),
        );
      }

      const hardenedMetadata: Record<string, unknown> = {
        ...metadata,
        source: "calculator",
        drugName,
        medicationName: drugName,
        doseUnit: "mg_per_kg",
        weightKg,
        chosenDoseMgPerKg: recalculated.normalizedDoseMgPerKg,
        doseMgPerKg: recalculated.normalizedDoseMgPerKg,
        concentrationMgPerMl,
        recommendedDoseMgPerKg:
          typeof recommendedDoseMgPerKg === "number" && Number.isFinite(recommendedDoseMgPerKg)
            ? recommendedDoseMgPerKg
            : null,
        defaultDoseMgPerKg:
          typeof recommendedDoseMgPerKg === "number" && Number.isFinite(recommendedDoseMgPerKg)
            ? recommendedDoseMgPerKg
            : null,
        totalMg: recalculated.totalMg,
        volumeMl: recalculated.volumeMl,
        calculatedVolumeMl: recalculated.volumeMl,
        deviationPercent: recalculated.deviationPercent,
        idempotencyKey,
        createdByRole: role,
        calculationVersion: CALCULATION_VERSION,
      };

      payload = {
        ...parsed.data,
        vetId: req.authUser!.id,
        status: "in_progress",
        metadata: hardenedMetadata,
      };
    }

    const appointment = await createAppointment(
      req.clinicId!,
      payload,
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
  if (parsed.data.taskType === "medication" && !requireMedicationActionPermission(req, res, "med.dose.edit")) {
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
