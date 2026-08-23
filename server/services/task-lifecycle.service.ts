// Extracted from appointments.service.ts per ADR-002 (corrected two-way split —
// see docs/architecture/adr-002-appointments-service-split.md and
// docs/architecture/adr-002-correct-stale-medication-split). Task lifecycle:
// start/complete, technician task queries, and the task-assignment /
// stale-ownership authority wiring.
//
// AppointmentServiceError and AppointmentStatus are defined HERE rather than in
// scheduling.service.ts (where the original decomposition plan placed them)
// because task-lifecycle functions (startTask, completeTask,
// applyTaskAssignmentEvaluator, applyStaleTaskOwnershipObservation) construct
// and type-cast against them directly. scheduling.service.ts re-exports both
// so its own public surface is unchanged; see that file's header for the full
// explanation of why this avoids a module cycle with scheduling.service.ts
// (which must import applyTaskAssignmentEvaluator from here).

import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { TaskPriority, TaskType } from "../domain/service-task.adapter.js";
import { appointments, clinicalCheckIns, db, users } from "../db.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { clinicTodayIsoDate, getClinicDayUtcRange, getClinicTimezone } from "../lib/clinic-timezone.js";
import { incrementMetric } from "../lib/metrics.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
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

export interface TaskAuditActor {
  userId: string;
  clerkId?: string;
  email: string;
  role?: string;
}

export type { TaskPriority, TaskType } from "../domain/service-task.adapter.js";

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

type AppointmentRecord = typeof appointments.$inferSelect;

const DB_ACTIVE_STATUSES: AppointmentStatus[] = ["pending", "assigned", "scheduled", "arrived", "in_progress"];

function assertClinicId(clinicId: string): string {
  const normalized = clinicId.trim();
  if (!normalized) {
    throw new AppointmentServiceError("MISSING_CLINIC_ID", 400, "clinicId is required");
  }
  return normalized;
}

// Duplicated (verbatim) from scheduling.service.ts. Small, pure, and used on
// both sides of the split; keeping one copy per file avoids a module cycle
// without the drift risk a shared mutable dependency would carry.
const PRIORITIES: TaskPriority[] = ["critical", "high", "normal"];

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

function assertServiceTaskType(taskType: TaskType | null | undefined): void {
  if ((taskType as string | null | undefined) === "medication") {
    throw new AppointmentServiceError("MEDICATION_TASKS_DISABLED", 410, "Medication tasks are no longer supported");
  }
}

// Duplicated (verbatim) from scheduling.service.ts — see PRIORITIES above.
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

type TaskRealtimeEventType =
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_CANCELLED"
  | "TASK_STARTED"
  | "TASK_COMPLETED";

/**
 * Task lifecycle realtime emission. Writes to `vt_event_outbox` (the frozen
 * outbox-backed transport) so the event carries a monotonic `id:` cursor and is
 * covered by `GET /api/realtime/replay` — durability and replay coverage the
 * legacy in-memory broadcast did not provide.
 *
 * NOT a cross-instance fan-out. `outboxEmitter` (`server/lib/event-publisher.ts`)
 * is a bare in-process `EventEmitter` with no Redis adapter, and
 * `publishOneBatch` claims each row with `FOR UPDATE SKIP LOCKED`. With more than
 * one API replica the live frame reaches only the replica that claimed the row;
 * clients on the other replicas pick the event up on reconnect replay, not live.
 * Do not describe this path as cross-instance delivery.
 *
 * Best-effort, exactly like the broadcast it replaces: a realtime failure must
 * never fail the clinical mutation. Awaited rather than fire-and-forget so
 * paired emissions (e.g. TASK_CANCELLED then TASK_UPDATED) keep their relative
 * order in the outbox id sequence.
 *
 * Exported (not barrel-facing — appointments.service.ts does not re-export it)
 * so scheduling.service.ts can import it too; createAppointment/updateAppointment/
 * cancelAppointment call it the same way startTask/completeTask do. Centralized
 * here rather than duplicated because it performs a real DB write and duplicate
 * copies would be a drift risk.
 */
export async function emitTaskEvent(
  clinicId: string,
  type: TaskRealtimeEventType,
  payload: unknown,
): Promise<void> {
  try {
    await insertRealtimeDomainEvent(db, { clinicId, type, payload, category: "TASK" });
  } catch (err) {
    console.error("[appointments] task realtime outbox emit failed (non-fatal):", {
      type,
      clinicId,
      err: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Exported (not barrel-facing) for the same reason as emitTaskEvent: both
 * scheduling.service.ts's create/update/cancel and this file's startTask/
 * completeTask/getTasksXxx serialize appointment rows, and centralizing the
 * row-shape logic avoids two copies drifting apart.
 */
export function serializeAppointment(row: AppointmentRecord) {
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

export function serializeAppointmentRowsSkippingMalformed(rows: AppointmentRecord[], context: string): SerializedAppointmentRow[] {
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
  await emitTaskEvent(clinicId, "TASK_STARTED", serialized);
  await emitTaskEvent(clinicId, "TASK_UPDATED", serialized);
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
  await emitTaskEvent(clinicId, "TASK_COMPLETED", serialized);
  await emitTaskEvent(clinicId, "TASK_UPDATED", serialized);
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

  // Inlined equivalent of scheduling.service.ts's getAppointmentsByDay
  // (same query shape, same "getAppointmentsByDay" log context on malformed
  // rows) rather than importing it: that import would combine with the
  // mandatory scheduling -> task-lifecycle edge (applyTaskAssignmentEvaluator)
  // to form a module cycle. `day` is always a valid YYYY-MM-DD string here
  // (freshly computed by clinicTodayIsoDate), so getAppointmentsByDay's own
  // day-format guard is omitted as unreachable in this call path.
  const { dayStart, dayEnd } = await getClinicDayUtcRange(clinicId, day);

  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clinicId, clinicId), gte(appointments.startTime, dayStart), lt(appointments.startTime, dayEnd)))
    .orderBy(appointments.startTime);

  return serializeAppointmentRowsSkippingMalformed(rows, "getAppointmentsByDay");
}
