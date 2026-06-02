// TODO(adr-002): Split into scheduling.service.ts, task-lifecycle.service.ts,
// medication-execution.service.ts. See docs/architecture/adr-002-appointments-service-split.md
// Boundaries are marked with === SECTION === comments below.

import { randomUUID } from "crypto";
import { and, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { TaskPriority, TaskType } from "../domain/service-task.adapter.js";
import { appointments, clinicalCheckIns, db, shifts, users } from "../db.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  clinicTodayIsoDate,
  getClinicDayUtcRange,
  getClinicTimezone,
} from "../lib/clinic-timezone.js";
import { incrementMetric } from "../lib/metrics.js";
import { broadcast } from "../lib/realtime.js";
import { sendTaskNotification } from "../lib/task-notification.js";
import {
  resolveStaleTaskOwnershipEnforcementMode,
  resolveTaskAssignmentEnforcementMode,
} from "../lib/authority/enforcement/config.js";
import { evaluateTaskAssignment } from "../lib/authority/enforcement/task-assignment.evaluator.js";
import { evaluateStaleTaskOwnership } from "../lib/authority/enforcement/stale-task-ownership.evaluator.js";
import type {
  TaskAssignmentTargetUser,
  TaskAssignmentTransition,
} from "../lib/authority/enforcement/result.js";
export type AppointmentStatus =
  | "pending"
  | "assigned"
  | "scheduled"
  | "arrived"
  | "approved"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface TaskAuditActor {
  userId: string;
  clerkId?: string;
  email: string;
  role?: string;
}


export type { TaskPriority, TaskType } from "../domain/service-task.adapter.js";

type AppointmentRecord = typeof appointments.$inferSelect;

const PRIORITIES: TaskPriority[] = ["critical", "high", "normal"];
const TASK_TYPES: TaskType[] = ["maintenance", "repair", "inspection"];

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

export class AppointmentServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppointmentServiceError";
  }
}

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

const DB_ACTIVE_STATUSES: AppointmentStatus[] = ["pending", "assigned", "scheduled", "arrived", "in_progress"];

/**
 * Phase 3 PR 3.4 — Hydrate target user fields for the task-assignment evaluator.
 *
 * Called ONLY when the task-assignment enforcement mode is not 'off'. This
 * preserves the byte-identical off-mode invariant: no new DB query fires
 * when the evaluator family is disabled for the clinic.
 *
 * When `userId` does not exist in `vt_users`, returns a synthetic record
 * with `status = "unknown"` so the evaluator's precedence (TARGET_NOT_ACTIVE
 * after TARGET_CROSS_CLINIC) maps it to TARGET_NOT_ACTIVE in enforce mode.
 * Per §9.11, expanding the evaluator's reason union with a dedicated
 * TARGET_NOT_FOUND is out of PR 3.4 scope.
 */
async function loadTargetUserForAssignment(
  userId: string,
  clinicId: string,
): Promise<TaskAssignmentTargetUser> {
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      clinicId: users.clinicId,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) {
    // Synthetic record. clinicId matches the request so the cross-clinic
    // check passes; status is non-"active" so the not-active check denies.
    return {
      userId,
      role: "unknown",
      clinicId,
      status: "unknown",
      deletedAt: null,
    };
  }
  return {
    userId: row.id,
    role: row.role,
    clinicId: row.clinicId,
    status: row.status,
    deletedAt: row.deletedAt,
  };
}

/**
 * Phase 3 PR 3.4 — Service-layer wiring for the PR 3.3 task-assignment evaluator.
 *
 * Off-mode byte-identical invariant: the mode is resolved FIRST. In `off`,
 * no target user is hydrated and the evaluator is not invoked, so the only
 * DB-visible side effect is the per-clinic cached config probe (10s TTL).
 *
 * In `shadow`: the evaluator emits counters; the verdict is `allow`; the
 * service path proceeds unchanged.
 *
 * In `enforce`: a deny verdict throws AppointmentServiceError with code
 * TASK_ASSIGNMENT_DENIED and the verdict reason in `details.reason`. The
 * route's sendServiceError surfaces this as a 403 with the same shape.
 *
 * Strategy A: `resolveTaskAssignmentEnforcementMode` already catches
 * getServerConfigValue throws and falls back to env / "off" (PR 3.3 §3
 * config.ts). If `evaluateTaskAssignment` itself throws (defensive — its
 * tests prove it doesn't), the throw propagates; this is consistent with
 * other resolver-side throws in the service path.
 */
export async function applyTaskAssignmentEvaluator(args: {
  clinicId: string;
  actor: TaskAuditActor;
  targetUserId: string;
  transition: TaskAssignmentTransition;
  taskType: TaskType | null | undefined;
  currentAcknowledgedUserId: string | null;
  currentStatus: string;
}): Promise<void> {
  // Strategy A safety net at the wiring layer: any resolver-side failure
  // degrades to off without blocking the mutation. The mutation proceeds as
  // if the family were disabled for the clinic. The resolver itself catches
  // getServerConfigValue throws internally, so reaching this catch is
  // defense-in-depth.
  let mode: Awaited<ReturnType<typeof resolveTaskAssignmentEnforcementMode>>;
  try {
    mode = await resolveTaskAssignmentEnforcementMode(args.clinicId);
  } catch {
    return;
  }
  if (mode === "off") return;

  const target = await loadTargetUserForAssignment(args.targetUserId, args.clinicId);

  const verdict = await evaluateTaskAssignment(
    {
      clinicId: args.clinicId,
      now: new Date(),
      transition: args.transition,
      actor: { userId: args.actor.userId, role: args.actor.role ?? "" },
      target,
      taskType: args.taskType ?? null,
      currentOwnership: {
        acknowledgedUserId: args.currentAcknowledgedUserId,
        status: args.currentStatus,
      },
    },
    { modeResolver: async () => mode },
  );

  if (verdict.action === "deny") {
    throw new AppointmentServiceError(
      "TASK_ASSIGNMENT_DENIED",
      403,
      "Task assignment denied by policy",
      { reason: verdict.reason, transition: args.transition },
    );
  }
}

/**
 * Phase 3 PR 3.7 — Stale-task-ownership wiring defaults.
 *
 * These are the same constants the PR 3.6 sweeper uses; centralising them
 * here is intentional so the wiring and the sweeper agree on what "stale"
 * means. A future PR may move these to enforcement/config.ts if other
 * call sites need them.
 */
const STALE_TASK_OWNERSHIP_DEFAULT_GRACE_WINDOW_MS = 15 * 60 * 1000;
const STALE_TASK_OWNERSHIP_DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Phase 3 PR 3.7 — Look up an owner's most recent check-in state.
 *
 * Returns null when the owner is currently checked in OR has no recorded
 * check-in (both treated as "not stale" by the evaluator). Otherwise
 * returns the most recent `checkedOutAt` timestamp.
 *
 * Called ONLY when the stale-task-ownership mode is not "off" so the
 * off-mode invariant (no new DB queries) is preserved.
 */
async function loadOwnerCheckInEndedAtForStaleness(
  userId: string,
  clinicId: string,
): Promise<Date | null> {
  const open = await db
    .select({ id: clinicalCheckIns.id })
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        eq(clinicalCheckIns.userId, userId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .limit(1);
  if (open.length > 0) return null;

  const closed = await db
    .select({ checkedOutAt: clinicalCheckIns.checkedOutAt })
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        eq(clinicalCheckIns.userId, userId),
      ),
    )
    .orderBy(sql`${clinicalCheckIns.checkedOutAt} DESC NULLS LAST`)
    .limit(1);
  return closed[0]?.checkedOutAt ?? null;
}

/**
 * Phase 3 PR 3.7 — Service-layer wiring for the PR 3.6 stale-task-ownership evaluator.
 *
 * Observation-only across ALL modes (off | shadow | enforce). Per the
 * master plan §12.4: the wiring never denies, never revokes, never
 * mutates ownership, never alters responses. PR 3.6 already established
 * the same property for the sweeper. PR 3.8 will add the actual deny /
 * revoke behavior within its tightly-bounded carve-out (§13.3 / §13.16).
 *
 * Off-mode invariant: mode is resolved FIRST. In `off`, no DB query
 * happens and the evaluator is not invoked. The only allowed side effect
 * is the per-clinic cached config probe (10s TTL, shared infrastructure).
 *
 * Strategy A safety net: any resolver-side failure degrades to off.
 *
 * The evaluator's verdict is INTENTIONALLY IGNORED here. Its side
 * effects (metric increments, shadow-mode would-have-revoked audit) are
 * the observability output. The function returns void regardless.
 */
export async function applyStaleTaskOwnershipObservation(args: {
  clinicId: string;
  taskId: string;
  acknowledgedUserId: string | null;
  acknowledgedAt: Date | null;
  status: string;
  updatedAt: Date;
}): Promise<void> {
  // No owner to evaluate — staleness is meaningless without an
  // established owner. This is the common case for first-time
  // startTask before any acknowledge has occurred.
  if (!args.acknowledgedUserId) return;

  let mode: Awaited<ReturnType<typeof resolveStaleTaskOwnershipEnforcementMode>>;
  try {
    mode = await resolveStaleTaskOwnershipEnforcementMode(args.clinicId);
  } catch {
    return;
  }
  if (mode === "off") return;

  let ownerCheckInEndedAt: Date | null;
  try {
    ownerCheckInEndedAt = await loadOwnerCheckInEndedAtForStaleness(
      args.acknowledgedUserId,
      args.clinicId,
    );
  } catch {
    // If the check-in lookup fails, treat as degraded mode at the
    // evaluator boundary. The evaluator records degradedModePause and
    // returns allow.
    //
    // PR 3.7.1: wrap the evaluator call in try/catch. The helper's
    // observation-only contract (§12.4) requires that unexpected
    // evaluator failures NEVER propagate into the caller's task-
    // mutation flow. The intentional PR 3.8 STALE_OWNERSHIP_DENIED
    // throw lives OUTSIDE this try block and propagates normally.
    try {
      await evaluateStaleTaskOwnership(
        {
          clinicId: args.clinicId,
          now: new Date(),
          graceWindowMs: STALE_TASK_OWNERSHIP_DEFAULT_GRACE_WINDOW_MS,
          activityWindowMs: STALE_TASK_OWNERSHIP_DEFAULT_ACTIVITY_WINDOW_MS,
          emergencySuspend: false,
          resolverOperational: false,
          task: {
            id: args.taskId,
            acknowledgedUserId: args.acknowledgedUserId,
            acknowledgedAt: args.acknowledgedAt,
            status: args.status,
            updatedAt: args.updatedAt,
          },
          ownerCheckInEndedAt: null,
        },
        { modeResolver: async () => mode },
      );
    } catch (err) {
      console.warn("[stale-task-ownership-wiring] degraded-mode evaluator threw — observation suppressed", {
        clinicId: args.clinicId,
        taskId: args.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // Invoke the evaluator. In shadow mode the verdict is discarded — the
  // evaluator's internal side effects (counters + audit) are the entire
  // output. In enforce mode (PR 3.8 activation), a `would_revoke`
  // verdict is mapped to a 403 AppointmentServiceError; the active-
  // treatment safety floor is structurally preserved because the
  // evaluator never produces `would_revoke` for active-treatment tasks
  // (it returns `allow + protected: ACTIVE_TREATMENT` instead).
  //
  // PR 3.7.1: wrap the evaluator call in try/catch. If the evaluator
  // itself ever throws (defensive — its tests prove it shouldn't), the
  // wiring degrades to allow rather than failing the user-facing
  // mutation. The intentional STALE_OWNERSHIP_DENIED throw lives
  // OUTSIDE this try block: it fires from inspecting the `verdict`
  // value, not from inside `evaluateStaleTaskOwnership`.
  let verdict;
  try {
    verdict = await evaluateStaleTaskOwnership(
      {
        clinicId: args.clinicId,
        now: new Date(),
        graceWindowMs: STALE_TASK_OWNERSHIP_DEFAULT_GRACE_WINDOW_MS,
        activityWindowMs: STALE_TASK_OWNERSHIP_DEFAULT_ACTIVITY_WINDOW_MS,
        emergencySuspend: false,
        resolverOperational: true,
        task: {
          id: args.taskId,
          acknowledgedUserId: args.acknowledgedUserId,
          acknowledgedAt: args.acknowledgedAt,
          status: args.status,
          updatedAt: args.updatedAt,
        },
        ownerCheckInEndedAt,
      },
      { modeResolver: async () => mode },
    );
  } catch (err) {
    console.warn("[stale-task-ownership-wiring] evaluator threw — observation suppressed, degrading to allow", {
      clinicId: args.clinicId,
      taskId: args.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Phase 3 PR 3.8 — Enforce-branch deny activation (§13.3 / §13.16).
  // In shadow mode this branch is never reached (the evaluator returns
  // `allow` even for stale rows in shadow). The mode === "enforce"
  // check is a defense-in-depth invariant: if the evaluator ever
  // returned `would_revoke` outside enforce, we still want to allow
  // (observation-only contract intact).
  if (verdict.action === "would_revoke" && mode === "enforce") {
    throw new AppointmentServiceError(
      "STALE_OWNERSHIP_DENIED",
      403,
      "Task ownership is stale; the owner's check-in has ended past the grace window.",
      { reason: verdict.reason, taskId: args.taskId },
    );
  }
}

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

function normalizePriority(priority: TaskPriority | undefined): TaskPriority {
  if (priority === undefined) return "normal";
  if (!PRIORITIES.includes(priority)) {
    throw new AppointmentServiceError("INVALID_PRIORITY", 400, "Invalid priority", { priority });
  }
  return priority;
}


function normalizeRole(roleInput: string | null | undefined): string {
  return (roleInput ?? "").trim().toLowerCase();
}

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function assertServiceTaskType(taskType: TaskType | null | undefined): void {
  if ((taskType as string | null | undefined) === "medication") {
    throw new AppointmentServiceError("MEDICATION_TASKS_DISABLED", 410, "Medication tasks are no longer supported");
  }
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

async function assertWithinVetShift(args: {
  clinicId: string;
  vetId: string | null;
  startTime: Date;
  endTime: Date;
}): Promise<void> {
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

function serializeAppointment(row: AppointmentRecord) {
  const col =
    typeof row.containerId === "string" && row.containerId.trim().length > 0 ? row.containerId.trim() : null;
  return {
    ...row,
    containerId: col,
    vetId: row.vetId ?? null,
    startTime: new Date(row.startTime).toISOString(),
    endTime: new Date(row.endTime).toISOString(),
    scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    metadata: row.metadata ?? null,
    appointmentType: row.appointmentType ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

type SerializedAppointmentRow = ReturnType<typeof serializeAppointment>;

function serializeAppointmentRowsSkippingMalformed(rows: AppointmentRecord[], context: string): SerializedAppointmentRow[] {
  const out: SerializedAppointmentRow[] = [];
  for (const row of rows) {
    try {
      out.push(serializeAppointment(row));
    } catch (rowErr) {
      console.warn(`[${context}] skipping malformed row id=%s:`, row.id, rowErr);
    }
  }
  return out;
}

// === SCHEDULING (→ scheduling.service.ts) ====================================

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
    await assertWithinVetShift({ clinicId, vetId, startTime, endTime });
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
  broadcast(clinicId, { type: "TASK_CREATED", payload: serialized });
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
  broadcast(clinicId, { type: "TASK_UPDATED", payload: serialized });
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
  broadcast(clinicId, { type: "TASK_CANCELLED", payload: serialized });
  broadcast(clinicId, { type: "TASK_UPDATED", payload: serialized });
  return serialized;
}

// === TASK LIFECYCLE (→ task-lifecycle.service.ts) ============================

export async function startTask(clinicIdInput: string, taskId: string, actor: TaskAuditActor) {
  const clinicId = assertClinicId(clinicIdInput);
  const [existing] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, taskId), eq(appointments.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppointmentServiceError("APPOINTMENT_NOT_FOUND", 404, "Appointment not found");
  }

  assertServiceTaskType(existing.taskType as TaskType | null);

  const actorRole = normalizeRole(actor.role);

  const vetId = existing.vetId;
  if (!vetId) {
    throw new AppointmentServiceError("TASK_NOT_ASSIGNED", 400, "Task has no technician assigned");
  }
  const canBypassOwnership = actorRole === "admin" || actorRole === "vet" || actorRole === "senior_technician";
  if (vetId !== actor.userId && !canBypassOwnership) {
    throw new AppointmentServiceError("TASK_NOT_OWNED_BY_TECH", 403, "Only the assigned technician can start this task");
  }

  // Phase 3 PR 3.4 — task-assignment evaluator wiring (acknowledge). No-op in
  // `off` mode. Self-acknowledge: target == actor. The current ownership row
  // is the existing acknowledged_user_id (PR 3.1) — null on first start,
  // non-null only if a prior acknowledge persisted.
  //
  // Supervisors (admin / vet / senior_technician) who bypass ownership at this
  // service layer via canBypassOwnership are ALSO exempt from the evaluator's
  // acknowledge-time check. They are not acquiring ownership of the task —
  // they are overriding it (existing pre-PR-3.4 semantics). Subjecting them to
  // the evaluator would regress non-medication startTask for vet and
  // senior_technician, whose roles do not permit `task.start` per task-rbac.ts
  // and would therefore fail the evaluator's TARGET_ROLE_NOT_PERMITTED check
  // in enforce mode. Keeping the bypass exempt preserves byte-identical
  // behavior for the existing supervisor-override path.
  if (!canBypassOwnership) {
    await applyTaskAssignmentEvaluator({
      clinicId,
      actor,
      targetUserId: actor.userId,
      transition: "acknowledge",
      taskType: existing.taskType as TaskType | null,
      currentAcknowledgedUserId: existing.acknowledgedUserId,
      currentStatus: existing.status,
    });
  }

  const from = existing.status as AppointmentStatus;
  {
    // Service tasks (maintenance, repair, inspection) may start from pre-work states.
    if (!["scheduled", "assigned", "arrived", "approved"].includes(from)) {
      throw new AppointmentServiceError("INVALID_STATUS_TRANSITION", 400, "Task cannot be started from this status", {
        from,
        to: "in_progress",
      });
    }
  }

  // Phase 3 PR 3.7 — stale-task-ownership observation wiring. Observation
  // only: never throws, never alters response shape, even in enforce mode
  // (per §12.4). Placed AFTER the status-transition validation so failed
  // start attempts (e.g., retries on an already in_progress task) do NOT
  // pollute the shadow observability signal. The wiring helper internally
  // enforces the active-treatment safety floor by inspecting
  // `existing.updatedAt`; per §12.6, startTask must bypass any
  // stale-denial semantics during active-treatment windows — the
  // evaluator handles this automatically.
  await applyStaleTaskOwnershipObservation({
    clinicId,
    taskId: existing.id,
    acknowledgedUserId: existing.acknowledgedUserId,
    acknowledgedAt: existing.acknowledgedAt,
    status: existing.status,
    updatedAt: existing.updatedAt,
  });

  await assertVetInClinic(clinicId, vetId);

  const now = new Date();
  const previousSnapshot = { ...serializeAppointment(existing) };
  const [updated] = await db
    .update(appointments)
    .set({
      status: "in_progress",
      scheduledAt: existing.scheduledAt ?? existing.startTime,
      updatedAt: now,
    })
    .where(and(eq(appointments.id, taskId), eq(appointments.clinicId, clinicId)))
    .returning();

  const serialized = serializeAppointment(updated);
  incrementMetric("tasks_started");
  logAudit({
    clinicId,
    actionType: "task_started",
    performedBy: actor.userId,
    performedByEmail: actor.email,
    actorRole: resolveAuditActorRole({ effectiveRole: actor.role }),
    targetId: taskId,
    targetType: "task",
    metadata: { previousState: previousSnapshot, newState: { ...serialized } },
  });
  void sendTaskNotification("TASK_STARTED", serialized, actor).catch(() => {});
  broadcast(clinicId, { type: "TASK_STARTED", payload: serialized });
  broadcast(clinicId, { type: "TASK_UPDATED", payload: serialized });
  return serialized;
}

export async function completeTask(
  clinicIdInput: string,
  taskId: string,
  actor: TaskAuditActor,
) {
  const clinicId = assertClinicId(clinicIdInput);
  const [existing] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, taskId), eq(appointments.clinicId, clinicId)))
    .limit(1);

  if (!existing) {
    throw new AppointmentServiceError("APPOINTMENT_NOT_FOUND", 404, "Appointment not found");
  }

  assertServiceTaskType(existing.taskType as TaskType | null);

  const vetId = existing.vetId;
  if (!vetId) {
    throw new AppointmentServiceError("TASK_NOT_ASSIGNED", 400, "Task has no technician assigned");
  }

  const actorRole = normalizeRole(actor.role);
  const canBypassOwnership = actorRole === "admin" || actorRole === "vet" || actorRole === "senior_technician";
  if (vetId !== actor.userId && !canBypassOwnership) {
    throw new AppointmentServiceError("TASK_NOT_OWNED_BY_TECH", 403, "Only the assigned technician can complete this task");
  }

  const from = existing.status as AppointmentStatus;
  if (from !== "in_progress") {
    throw new AppointmentServiceError("INVALID_STATUS_TRANSITION", 400, "Task must be in progress to complete", {
      from,
      to: "completed",
    });
  }

  // Phase 3 PR 3.7 — stale-task-ownership observation wiring. Observation
  // only: never throws, never alters response shape (per §12.4). Placed
  // AFTER the status-transition validation so retries against an
  // already-completed (or otherwise invalid-state) task do NOT pollute
  // the shadow observability signal. The active-treatment safety floor
  // is enforced inside the evaluator.
  await applyStaleTaskOwnershipObservation({
    clinicId,
    taskId: existing.id,
    acknowledgedUserId: existing.acknowledgedUserId,
    acknowledgedAt: existing.acknowledgedAt,
    status: existing.status,
    updatedAt: existing.updatedAt,
  });

  await assertVetInClinic(clinicId, vetId);

  const previousSnapshot = { ...serializeAppointment(existing) };
  const completedAt = new Date();
  const [updated] = await db
    .update(appointments)
    .set({
      status: "completed",
      completedAt,
      updatedAt: completedAt,
    })
    .where(and(eq(appointments.id, taskId), eq(appointments.clinicId, clinicId)))
    .returning();

  if (!updated) {
    throw new AppointmentServiceError("APPOINTMENT_NOT_FOUND", 404, "Appointment not found");
  }

  const serialized = serializeAppointment(updated);
  incrementMetric("tasks_completed");
  logAudit({
    clinicId,
    actionType: "task_completed",
    performedBy: actor.userId,
    performedByEmail: actor.email,
    actorRole: resolveAuditActorRole({ effectiveRole: actor.role }),
    targetId: taskId,
    targetType: "task",
    metadata: { previousState: previousSnapshot, newState: { ...serialized } },
  });
  void sendTaskNotification("TASK_COMPLETED", serialized, actor).catch(() => {});
  broadcast(clinicId, { type: "TASK_COMPLETED", payload: serialized });
  broadcast(clinicId, { type: "TASK_UPDATED", payload: serialized });
  return { task: serialized };
}

export async function getTasksForTechnician(clinicIdInput: string, technicianId: string) {
  const clinicId = assertClinicId(clinicIdInput);
  await assertVetInClinic(clinicId, technicianId);

  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clinicId, clinicId), eq(appointments.vetId, technicianId)))
    .orderBy(desc(appointments.startTime));

  return serializeAppointmentRowsSkippingMalformed(rows, "getTasksForTechnician");
}

/** Today's tasks (clinic-local calendar day) for a technician — used by GET /api/tasks/me. */
export async function getTasksForTechnicianToday(clinicIdInput: string, technicianId: string) {
  const clinicId = assertClinicId(clinicIdInput);
  await assertVetInClinic(clinicId, technicianId);

  const timeZone = await getClinicTimezone(clinicId);
  const day = clinicTodayIsoDate(timeZone);
  const { dayStart, dayEnd } = await getClinicDayUtcRange(clinicId, day);

  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        eq(appointments.vetId, technicianId),
        gte(appointments.startTime, dayStart),
        lt(appointments.startTime, dayEnd),
      ),
    )
    .orderBy(appointments.startTime);

  return serializeAppointmentRowsSkippingMalformed(rows, "getTasksForTechnicianToday");
}

export async function getTasksByPriority(clinicIdInput: string, priority: TaskPriority) {
  const clinicId = assertClinicId(clinicIdInput);
  const p = normalizePriority(priority);

  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clinicId, clinicId), eq(appointments.priority, p)))
    .orderBy(desc(appointments.startTime));

  return serializeAppointmentRowsSkippingMalformed(rows, "getTasksByPriority");
}

export async function getActiveTasks(clinicIdInput: string) {
  const clinicId = assertClinicId(clinicIdInput);

  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clinicId, clinicId), inArray(appointments.status, DB_ACTIVE_STATUSES)))
    .orderBy(appointments.startTime);

  return serializeAppointmentRowsSkippingMalformed(rows, "getActiveTasks");
}

export async function getTodayTasks(clinicIdInput: string) {
  const clinicId = assertClinicId(clinicIdInput);
  const timeZone = await getClinicTimezone(clinicId);
  const day = clinicTodayIsoDate(timeZone);
  return getAppointmentsByDay(clinicIdInput, day);
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
