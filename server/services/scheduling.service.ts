// Extracted from appointments.service.ts per ADR-002 (corrected two-way split —
// see docs/architecture/adr-002-appointments-service-split.md and
// docs/architecture/adr-002-correct-stale-medication-split). Scheduling:
// create/update/cancel, conflict detection, the status state machine, and
// range/day/vet appointment queries.
//
// This file imports TaskAuditActor, applyTaskAssignmentEvaluator,
// AppointmentServiceError, AppointmentStatus, emitTaskEvent,
// serializeAppointment, and serializeAppointmentRowsSkippingMalformed from
// task-lifecycle.service.ts. AppointmentServiceError and AppointmentStatus are
// re-exported here (rather than defined here) so this module's own public
// surface still contains them, matching the original decomposition plan —
// but their canonical definition lives in task-lifecycle.service.ts because
// task-lifecycle functions (startTask, completeTask,
// applyTaskAssignmentEvaluator, applyStaleTaskOwnershipObservation) also
// construct/type-cast against them. Defining them there and importing here
// keeps a single directional edge (scheduling -> task-lifecycle) instead of
// a cycle: task-lifecycle must not import anything from this file. A handful
// of small pure helpers used on both sides (assertClinicId, assertVetInClinic,
// normalizePriority/PRIORITIES) are duplicated rather than shared, since they
// carry no identity semantics and duplication is cheaper than a second edge.
import { randomUUID } from "crypto";
import { and, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import type { TaskPriority, TaskType } from "../domain/service-task.adapter.js";
import { appointments, db, shifts, users } from "../db.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { getClinicDayUtcRange } from "../lib/clinic-timezone.js";
import { incrementMetric } from "../lib/metrics.js";
import { sendTaskNotification } from "../lib/task-notification.js";
import {
  applyTaskAssignmentEvaluator,
  emitTaskEvent,
  serializeAppointment,
  serializeAppointmentRowsSkippingMalformed,
} from "./task-lifecycle.service.js";
import type { TaskAuditActor } from "./task-lifecycle.service.js";
export { AppointmentServiceError } from "./task-lifecycle.service.js";
export type { AppointmentStatus } from "./task-lifecycle.service.js";
import { AppointmentServiceError } from "./task-lifecycle.service.js";
import type { AppointmentStatus } from "./task-lifecycle.service.js";

export interface AppointmentInput {
  /** When omitted or empty, task is unassigned (pending queue). */
  vetId?: string | null;
  startTime: string | Date;
  endTime: string | Date;
  scheduledAt?: string | Date | null;
  status?: AppointmentStatus;
  conflictOverride?: boolean;
  overrideReason?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  priority?: TaskPriority;
  taskType?: TaskType | null;
  /** Scheduling context / purpose label. */
  appointmentType?: string | null;
  /** Who created this appointment/task (userId). */
  createdBy?: string | null;
}

export interface AppointmentUpdateInput {
  vetId?: string | null;
  startTime?: string | Date;
  endTime?: string | Date;
  scheduledAt?: string | Date | null;
  status?: AppointmentStatus;
  conflictOverride?: boolean;
  overrideReason?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  priority?: TaskPriority;
  taskType?: TaskType | null;
  appointmentType?: string | null;
}

const TASK_TYPES: TaskType[] = ["maintenance", "repair", "inspection"];

/** Statuses that participate in technician time overlap detection. */
const ACTIVE_CONFLICT_STATUSES: AppointmentStatus[] = ["scheduled", "assigned", "arrived", "in_progress"];
const ALL_STATUSES: AppointmentStatus[] = [
  "pending",
  "assigned",
  "scheduled",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
];

const VALID_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ["assigned", "scheduled", "cancelled"],
  assigned: ["arrived", "in_progress", "completed", "cancelled", "no_show"],
  scheduled: ["arrived", "in_progress", "completed", "cancelled", "no_show"],
  arrived: ["in_progress", "completed", "cancelled", "no_show"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

function assertClinicId(clinicId: string): string {
  const normalized = clinicId.trim();
  if (!normalized) {
    throw new AppointmentServiceError("MISSING_CLINIC_ID", 400, "clinicId is required");
  }
  return normalized;
}

// Exported for the datetime ISO-contract test (PR-17). The UI must send
// timezone-qualified ISO strings (offset or `Z`); offset-less input is rejected.
export function toUtcDate(value: string | Date, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new AppointmentServiceError("INVALID_TIME", 400, `${field} must be a valid UTC timestamp`);
    }
    return new Date(value.toISOString());
  }

  const raw = value.trim();
  if (!raw) {
    throw new AppointmentServiceError("INVALID_TIME", 400, `${field} is required`);
  }
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw new AppointmentServiceError(
      "TIMEZONE_REQUIRED",
      400,
      `${field} must include timezone offset or Z (UTC)`,
      { field },
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppointmentServiceError("INVALID_TIME", 400, `${field} must be a valid ISO timestamp`, { field });
  }
  return new Date(parsed.toISOString());
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes === undefined || notes === null) return null;
  const trimmed = notes.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(status: AppointmentStatus | undefined): AppointmentStatus {
  if (!status) return "scheduled";
  if (!ALL_STATUSES.includes(status)) {
    throw new AppointmentServiceError("INVALID_STATUS", 400, "Invalid appointment status", { status });
  }
  return status;
}

// Duplicated (verbatim) from task-lifecycle.service.ts. Small, pure, and used
// on both sides of the split; keeping one copy per file avoids a module
// cycle without the drift risk a shared mutable dependency would carry.
const PRIORITIES: TaskPriority[] = ["critical", "high", "normal"];

function normalizePriority(priority: TaskPriority | undefined): TaskPriority {
  if (priority === undefined) return "normal";
  if (!PRIORITIES.includes(priority)) {
    throw new AppointmentServiceError("INVALID_PRIORITY", 400, "Invalid priority", { priority });
  }
  return priority;
}

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTaskType(taskType: TaskType | null | undefined): TaskType | null {
  if ((taskType as string | null | undefined) === "medication") {
    throw new AppointmentServiceError("INVALID_TASK_TYPE", 400, "Medication tasks are no longer supported", { taskType });
  }
  if (taskType === undefined || taskType === null) return null;
  if (!TASK_TYPES.includes(taskType)) {
    throw new AppointmentServiceError("INVALID_TASK_TYPE", 400, "Invalid taskType", { taskType });
  }
  return taskType;
}

function ensureTimeWindow(startTime: Date, endTime: Date): void {
  if (endTime.getTime() <= startTime.getTime()) {
    throw new AppointmentServiceError("INVALID_TIME_WINDOW", 400, "endTime must be greater than startTime");
  }
}

// Duplicated (verbatim) from task-lifecycle.service.ts — see PRIORITIES above.
async function assertVetInClinic(clinicId: string, vetId: string): Promise<void> {
  const [vet] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, vetId), eq(users.clinicId, clinicId), isNull(users.deletedAt)))
    .limit(1);

  if (!vet) {
    throw new AppointmentServiceError("VET_NOT_IN_CLINIC", 403, "Vet does not belong to this clinic");
  }
}

async function getVetInClinic(clinicId: string, vetId: string): Promise<{ id: string; name: string; displayName: string }> {
  const [vet] = await db
    .select({
      id: users.id,
      name: users.name,
      displayName: users.displayName,
    })
    .from(users)
    .where(and(eq(users.id, vetId), eq(users.clinicId, clinicId), isNull(users.deletedAt)))
    .limit(1);
  if (!vet) {
    throw new AppointmentServiceError("VET_NOT_IN_CLINIC", 403, "Vet does not belong to this clinic");
  }
  return vet;
}

async function findActiveVetConflict(args: {
  clinicId: string;
  vetId: string | null;
  startTime: Date;
  endTime: Date;
  excludeAppointmentId?: string;
}): Promise<{ id: string; startTime: Date; endTime: Date } | null> {
  if (!args.vetId) return null;
  const whereBase = and(
    eq(appointments.clinicId, args.clinicId),
    eq(appointments.vetId, args.vetId),
    inArray(appointments.status, ACTIVE_CONFLICT_STATUSES),
    lt(appointments.startTime, args.endTime),
    gt(appointments.endTime, args.startTime),
    args.excludeAppointmentId ? ne(appointments.id, args.excludeAppointmentId) : undefined,
  );

  const [conflict] = await db
    .select({
      id: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
    })
    .from(appointments)
    .where(whereBase)
    .limit(1);

  return conflict ?? null;
}

async function assertNoVetConflict(args: {
  clinicId: string;
  vetId: string | null;
  startTime: Date;
  endTime: Date;
  conflictOverride: boolean;
  overrideReason: string | null;
  excludeAppointmentId?: string;
  existingConflict?: { id: string; startTime: Date; endTime: Date } | null;
}): Promise<void> {
  if (!args.vetId) return;
  const conflict =
    args.existingConflict !== undefined
      ? args.existingConflict
      : await findActiveVetConflict({
          clinicId: args.clinicId,
          vetId: args.vetId,
          startTime: args.startTime,
          endTime: args.endTime,
          excludeAppointmentId: args.excludeAppointmentId,
        });

  if (conflict) {
    if (!args.conflictOverride) {
      throw new AppointmentServiceError("APPOINTMENT_CONFLICT", 409, "Appointment overlaps existing slot", {
        conflictAppointmentId: conflict.id,
        conflictStartTime: conflict.startTime.toISOString(),
        conflictEndTime: conflict.endTime.toISOString(),
      });
    }
    if (!args.overrideReason) {
      throw new AppointmentServiceError(
        "OVERRIDE_REASON_REQUIRED",
        400,
        "overrideReason is required when conflictOverride is true",
      );
    }
    return;
  }
  if (args.conflictOverride) {
    throw new AppointmentServiceError("OVERRIDE_NOT_NEEDED", 400, "No active conflict found to override");
  }
}

function minutesFromUtcDate(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function parseShiftTimeToMinutes(shiftTime: string): number {
  const [hourRaw, minuteRaw] = shiftTime.split(":");
  const hour = Number.parseInt(hourRaw ?? "0", 10);
  const minute = Number.parseInt(minuteRaw ?? "0", 10);
  return hour * 60 + minute;
}

function utcIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Admin bypass (owner decision, 2026-07): an `admin` actor can create a task
 * at any time, regardless of the assigned vet's roster shift. `actorRole` is
 * only threaded in from `createAppointment` — `updateAppointment` does not
 * pass it, so the shift-window check is unchanged for edits/reschedules.
 */
export async function assertWithinVetShift(args: {
  clinicId: string;
  vetId: string | null;
  startTime: Date;
  endTime: Date;
  actorRole?: string;
}): Promise<void> {
  if (args.actorRole === "admin") return;
  if (!args.vetId) return;
  if (utcIsoDate(args.startTime) !== utcIsoDate(args.endTime)) {
    throw new AppointmentServiceError("OUTSIDE_SHIFT", 400, "Appointment must start and end on the same clinic day");
  }

  const vet = await getVetInClinic(args.clinicId, args.vetId);
  const day = utcIsoDate(args.startTime);
  const startMinutes = minutesFromUtcDate(args.startTime);
  const endMinutes = minutesFromUtcDate(args.endTime);

  const candidateNames = [vet.displayName.trim(), vet.name.trim()].filter(Boolean);
  if (candidateNames.length === 0) {
    throw new AppointmentServiceError("OUTSIDE_SHIFT", 400, "Vet profile is missing a schedulable name");
  }
  const nameConditions = candidateNames.map((name) => eq(shifts.employeeName, name));
  const nameFilter = nameConditions.length === 1 ? nameConditions[0] : or(...nameConditions);

  const shiftRows = await db
    .select({
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      employeeName: shifts.employeeName,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.clinicId, args.clinicId),
        eq(shifts.date, day),
        nameFilter,
      ),
    );

  const inShift = shiftRows.some((shiftRow) => {
    const shiftStart = parseShiftTimeToMinutes(shiftRow.startTime);
    const shiftEnd = parseShiftTimeToMinutes(shiftRow.endTime);
    return startMinutes >= shiftStart && endMinutes <= shiftEnd;
  });

  if (!inShift) {
    throw new AppointmentServiceError("OUTSIDE_SHIFT", 400, "Cannot schedule outside vet shift hours", {
      date: day,
      vetId: args.vetId,
      vetName: vet.displayName || vet.name,
      startTime: args.startTime.toISOString(),
      endTime: args.endTime.toISOString(),
    });
  }
}

function ensureStatusTransition(current: AppointmentStatus, next: AppointmentStatus): void {
  if (current === next) return;
  const allowed = VALID_STATUS_TRANSITIONS[current] ?? [];
  if (allowed.includes(next)) return;

  if (next === "cancelled" && current !== "cancelled" && current !== "completed") return;
  if (current === "pending" && (next === "assigned" || next === "scheduled")) return;
  if (["assigned", "scheduled", "arrived"].includes(current) && next === "in_progress") return;
  if (current === "in_progress" && next === "completed") return;

  throw new AppointmentServiceError("INVALID_STATUS_TRANSITION", 400, `Cannot change status from ${current} to ${next}`, {
    from: current,
    to: next,
    allowed,
  });
}

function resolveCreateStatus(payload: AppointmentInput, vetId: string | null): AppointmentStatus {
  if (payload.status !== undefined) {
    const s = normalizeStatus(payload.status);
    if (!vetId && s !== "pending" && s !== "cancelled") {
      throw new AppointmentServiceError(
        "UNASSIGNED_TASK_STATUS",
        400,
        "Unassigned tasks must use status pending or cancelled",
      );
    }
    return s;
  }
  if (!vetId) return "pending";
  return "scheduled";
}

function auditTaskChange(
  action: "task_created" | "task_updated" | "task_cancelled",
  clinicId: string,
  actor: TaskAuditActor,
  taskId: string,
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): void {
  logAudit({
    clinicId,
    actionType: action,
    performedBy: actor.userId,
    performedByEmail: actor.email,
    actorRole: resolveAuditActorRole({ effectiveRole: actor.role }),
    targetId: taskId,
    targetType: "task",
    metadata: { previousState: previous, newState: next },
  });
}

export async function createAppointment(clinicIdInput: string, payload: AppointmentInput, actor?: TaskAuditActor) {
  const clinicId = assertClinicId(clinicIdInput);
  const startTime = toUtcDate(payload.startTime, "startTime");
  const endTime = toUtcDate(payload.endTime, "endTime");
  const scheduledAt = payload.scheduledAt ? toUtcDate(payload.scheduledAt, "scheduledAt") : startTime;
  ensureTimeWindow(startTime, endTime);

  const notes = normalizeNotes(payload.notes);
  const conflictOverride = payload.conflictOverride === true;
  const overrideReason = normalizeNotes(payload.overrideReason);
  const priority = normalizePriority(payload.priority);
  const taskType = normalizeTaskType(payload.taskType);
  const metadataInput = payload.metadata ?? null;
  const vetId = payload.vetId?.trim() ? payload.vetId.trim() : null;

  const status = resolveCreateStatus(payload, vetId);

  if (vetId) {
    await assertVetInClinic(clinicId, vetId);
  }

  // Phase 3 PR 3.4 — task-assignment evaluator wiring (assign). No-op in `off` mode.
  // Only fires when actor + vetId are both present (route-flow path). System
  // callers without an actor (e.g., backfills) bypass policy gates by design.
  if (actor && vetId) {
    await applyTaskAssignmentEvaluator({
      clinicId,
      actor,
      targetUserId: vetId,
      transition: "assign",
      taskType,
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
  }

  let finalConflictOverride = conflictOverride;
  let finalOverrideReason = overrideReason;
  let metadataRecord = asMetadataRecord(metadataInput);


  if (status !== "cancelled" && status !== "no_show") {
    await assertWithinVetShift({ clinicId, vetId, startTime, endTime, actorRole: actor?.role });
    const conflict = vetId
      ? await findActiveVetConflict({ clinicId, vetId, startTime, endTime })
      : null;
    if (conflict && priority === "critical" && vetId) {
      console.log(
        JSON.stringify({
          event: "PRIORITY_CRITICAL_OVERLAP",
          clinicId,
          vetId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          conflictAppointmentId: conflict.id,
        }),
      );
      finalConflictOverride = true;
      finalOverrideReason = "AUTO_CRITICAL";
    }
    await assertNoVetConflict({
      clinicId,
      vetId,
      startTime,
      endTime,
      conflictOverride: finalConflictOverride,
      overrideReason: finalOverrideReason,
      existingConflict: conflict,
    });
  } else if (conflictOverride && !overrideReason) {
    throw new AppointmentServiceError("OVERRIDE_REASON_REQUIRED", 400, "overrideReason is required when conflictOverride is true");
  }

  const now = new Date();
  const [created] = await db
    .insert(appointments)
    .values({
      id: randomUUID(),
      clinicId,
      vetId,
      startTime,
      endTime,
      scheduledAt,
      completedAt: status === "completed" ? now : null,
      status,
      conflictOverride: finalConflictOverride,
      overrideReason: finalOverrideReason,
      notes,
      metadata: metadataRecord,
      priority,
      taskType,
      containerId: null,
      appointmentType: payload.appointmentType?.trim() || null,
      createdBy: payload.createdBy?.trim() || actor?.userId || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const serialized = serializeAppointment(created);
  incrementMetric("tasks_created");
  if (actor) {
    auditTaskChange("task_created", clinicId, actor, serialized.id, null, { ...serialized });
    if (serialized.conflictOverride && serialized.overrideReason === "AUTO_CRITICAL" && serialized.priority === "critical") {
      logAudit({
        clinicId,
        actionType: "CRITICAL_TASK_EXECUTED",
        performedBy: actor.userId,
        performedByEmail: actor.email,
        actorRole: resolveAuditActorRole({ effectiveRole: actor.role }),
        targetId: serialized.id,
        targetType: "task",
        metadata: {
          conflictOverride: true,
          overrideReason: "AUTO_CRITICAL",
          previousState: null,
          newState: { ...serialized },
        },
      });
    }
  }
  void sendTaskNotification("TASK_CREATED", serialized, actor).catch(() => {});
  await emitTaskEvent(clinicId, "TASK_CREATED", serialized);
  return serialized;
}

export async function updateAppointment(
  clinicIdInput: string,
  appointmentId: string,
  payload: AppointmentUpdateInput,
  actor?: TaskAuditActor,
) {
  const clinicId = assertClinicId(clinicIdInput);
  const [existing] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppointmentServiceError("APPOINTMENT_NOT_FOUND", 404, "Appointment not found");
  }
  const previousSnapshot = { ...serializeAppointment(existing) };

  const nextVetId =
    payload.vetId === undefined ? existing.vetId : payload.vetId?.trim() ? payload.vetId.trim() : null;
  const nextStartTime = payload.startTime ? toUtcDate(payload.startTime, "startTime") : existing.startTime;
  const nextEndTime = payload.endTime ? toUtcDate(payload.endTime, "endTime") : existing.endTime;
  const nextScheduledAt =
    payload.scheduledAt === undefined
      ? (existing.scheduledAt ?? nextStartTime)
      : payload.scheduledAt === null
        ? null
        : toUtcDate(payload.scheduledAt, "scheduledAt");
  const nextStatus = payload.status ? normalizeStatus(payload.status) : (existing.status as AppointmentStatus);
  const nextConflictOverride =
    payload.conflictOverride === undefined ? existing.conflictOverride : payload.conflictOverride === true;
  const nextOverrideReason =
    payload.overrideReason === undefined ? existing.overrideReason : normalizeNotes(payload.overrideReason);
  const nextNotes = payload.notes === undefined ? existing.notes : normalizeNotes(payload.notes);
  const nextMetadataInput = payload.metadata === undefined ? existing.metadata : payload.metadata;
  const nextPriority =
    payload.priority !== undefined
      ? normalizePriority(payload.priority)
      : normalizePriority((existing as { priority?: TaskPriority }).priority);
  const nextTaskType =
    payload.taskType !== undefined
      ? normalizeTaskType(payload.taskType)
      : normalizeTaskType((existing as { taskType?: TaskType | null }).taskType);
  let nextMetadata = asMetadataRecord(nextMetadataInput);


  if (!nextVetId && nextStatus !== "pending" && nextStatus !== "cancelled") {
    throw new AppointmentServiceError(
      "UNASSIGNED_TASK_STATUS",
      400,
      "Unassigned tasks must use status pending or cancelled",
    );
  }

  ensureTimeWindow(nextStartTime, nextEndTime);
  ensureStatusTransition(existing.status as AppointmentStatus, nextStatus);
  if (nextVetId) {
    await assertVetInClinic(clinicId, nextVetId);
  }

  // Phase 3 PR 3.4 — task-assignment evaluator wiring (assign / reassign). No-op
  // in `off` mode. Fires only when nextVetId changes AND is non-null. Clearing
  // assignment (nextVetId === null) is a release path, not an assignment
  // transition, and is intentionally not wired.
  if (actor && nextVetId !== null && nextVetId !== existing.vetId) {
    await applyTaskAssignmentEvaluator({
      clinicId,
      actor,
      targetUserId: nextVetId,
      transition: existing.vetId === null ? "assign" : "reassign",
      taskType: nextTaskType,
      currentAcknowledgedUserId: existing.acknowledgedUserId,
      currentStatus: existing.status,
    });
  }

  let finalConflictOverride = nextConflictOverride;
  let finalOverrideReason = nextOverrideReason;

  if (nextStatus !== "cancelled" && nextStatus !== "no_show") {
    await assertWithinVetShift({ clinicId, vetId: nextVetId, startTime: nextStartTime, endTime: nextEndTime });
    const conflict = await findActiveVetConflict({
      clinicId,
      vetId: nextVetId,
      startTime: nextStartTime,
      endTime: nextEndTime,
      excludeAppointmentId: appointmentId,
    });
    if (conflict && nextPriority === "critical" && nextVetId) {
      console.log(
        JSON.stringify({
          event: "PRIORITY_CRITICAL_OVERLAP",
          clinicId,
          vetId: nextVetId,
          startTime: nextStartTime.toISOString(),
          endTime: nextEndTime.toISOString(),
          conflictAppointmentId: conflict.id,
          appointmentId,
        }),
      );
      finalConflictOverride = true;
      finalOverrideReason = "AUTO_CRITICAL";
      if (actor) {
        logAudit({
          clinicId,
          actionType: "CRITICAL_TASK_EXECUTED",
          performedBy: actor.userId,
          performedByEmail: actor.email,
          actorRole: resolveAuditActorRole({ effectiveRole: actor.role }),
          targetId: appointmentId,
          targetType: "task",
          metadata: {
            phase: "update",
            conflictOverride: true,
            overrideReason: "AUTO_CRITICAL",
            conflictAppointmentId: conflict.id,
          },
        });
      }
    }
    await assertNoVetConflict({
      clinicId,
      vetId: nextVetId,
      startTime: nextStartTime,
      endTime: nextEndTime,
      conflictOverride: finalConflictOverride,
      overrideReason: finalOverrideReason,
      excludeAppointmentId: appointmentId,
      existingConflict: conflict,
    });
  } else   if (nextConflictOverride && !nextOverrideReason) {
    throw new AppointmentServiceError("OVERRIDE_REASON_REQUIRED", 400, "overrideReason is required when conflictOverride is true");
  }

  const [updated] = await db
    .update(appointments)
    .set({
      vetId: nextVetId,
      startTime: nextStartTime,
      endTime: nextEndTime,
      scheduledAt: nextScheduledAt,
      completedAt: nextStatus === "completed" ? (existing.completedAt ?? new Date()) : existing.completedAt,
      status: nextStatus,
      conflictOverride: finalConflictOverride,
      overrideReason: finalOverrideReason,
      notes: nextNotes,
      metadata: nextMetadata,
      priority: nextPriority,
      taskType: nextTaskType,
      containerId: existing.containerId,
      ...(payload.appointmentType !== undefined
        ? { appointmentType: payload.appointmentType?.trim() || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
    .returning();

  const serialized = serializeAppointment(updated);
  if (actor) {
    auditTaskChange("task_updated", clinicId, actor, appointmentId, previousSnapshot, { ...serialized });
    if (
      serialized.conflictOverride &&
      serialized.overrideReason === "AUTO_CRITICAL" &&
      nextPriority === "critical" &&
      finalConflictOverride
    ) {
      logAudit({
        clinicId,
        actionType: "CRITICAL_TASK_EXECUTED",
        performedBy: actor.userId,
        performedByEmail: actor.email,
        actorRole: resolveAuditActorRole({ effectiveRole: actor.role }),
        targetId: appointmentId,
        targetType: "task",
        metadata: {
          conflictOverride: true,
          overrideReason: "AUTO_CRITICAL",
          previousState: previousSnapshot,
          newState: { ...serialized },
        },
      });
    }
  }
  await emitTaskEvent(clinicId, "TASK_UPDATED", serialized);
  return serialized;
}

export async function cancelAppointment(clinicIdInput: string, appointmentId: string, reason?: string, actor?: TaskAuditActor) {
  const clinicId = assertClinicId(clinicIdInput);
  const [existing] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppointmentServiceError("APPOINTMENT_NOT_FOUND", 404, "Appointment not found");
  }

  const previousSnapshot = { ...serializeAppointment(existing) };
  const notes = normalizeNotes(reason);
  const [updated] = await db
    .update(appointments)
    .set({
      status: "cancelled",
      ...(notes !== null ? { notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
    .returning();

  if (!updated) {
    throw new AppointmentServiceError("APPOINTMENT_NOT_FOUND", 404, "Appointment not found");
  }
  const serialized = serializeAppointment(updated);
  if (actor) {
    auditTaskChange("task_cancelled", clinicId, actor, appointmentId, previousSnapshot, { ...serialized });
  }
  void sendTaskNotification("TASK_CANCELLED", serialized, actor).catch(() => {});
  await emitTaskEvent(clinicId, "TASK_CANCELLED", serialized);
  await emitTaskEvent(clinicId, "TASK_UPDATED", serialized);
  return serialized;
}

export async function getAppointmentsByDay(clinicIdInput: string, dayIsoDate: string) {
  const clinicId = assertClinicId(clinicIdInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIsoDate)) {
    throw new AppointmentServiceError("INVALID_DAY", 400, "day must be YYYY-MM-DD");
  }

  const { dayStart, dayEnd } = await getClinicDayUtcRange(clinicId, dayIsoDate);

  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clinicId, clinicId), gte(appointments.startTime, dayStart), lt(appointments.startTime, dayEnd)))
    .orderBy(appointments.startTime);

  return serializeAppointmentRowsSkippingMalformed(rows, "getAppointmentsByDay");
}

export async function getAppointmentsByVet(
  clinicIdInput: string,
  vetId: string,
  startInclusive: string | Date,
  endExclusive: string | Date,
) {
  const clinicId = assertClinicId(clinicIdInput);
  const startTime = toUtcDate(startInclusive, "startTime");
  const endTime = toUtcDate(endExclusive, "endTime");
  ensureTimeWindow(startTime, endTime);
  await assertVetInClinic(clinicId, vetId);

  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        eq(appointments.vetId, vetId),
        gte(appointments.startTime, startTime),
        lt(appointments.startTime, endTime),
      ),
    )
    .orderBy(appointments.startTime);

  return serializeAppointmentRowsSkippingMalformed(rows, "getAppointmentsByVet");
}

export async function listAppointmentsByRange(clinicIdInput: string, startInclusive: string | Date, endExclusive: string | Date) {
  const clinicId = assertClinicId(clinicIdInput);
  const startTime = toUtcDate(startInclusive, "startTime");
  const endTime = toUtcDate(endExclusive, "endTime");
  ensureTimeWindow(startTime, endTime);

  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clinicId, clinicId), gte(appointments.startTime, startTime), lt(appointments.startTime, endTime)))
    .orderBy(appointments.startTime);

  return serializeAppointmentRowsSkippingMalformed(rows, "listAppointmentsByRange");
}
