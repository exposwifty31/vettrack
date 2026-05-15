/**
 * Phase 3 PR 3.3 — Task-assignment evaluator. Foundation only.
 *
 * PURE function over (mode, context). NO DB reads. NO cache reads. NO
 * mutation of task state. Side-effect invariant: only the documented
 * metrics increments (task-assignment.metrics.ts), the sampled shadow-mode
 * log line, and (in enforce mode) the rate-limited audit row via
 * task-assignment.audit.ts.
 *
 * Mode union: `off | shadow | enforce`. Default `off` (resolved in
 * `enforcement/config.ts::resolveTaskAssignmentEnforcementMode`).
 *
 * Isolation: this file does NOT import `stale.evaluator.ts` or
 * `oprole.evaluator.ts`. Enforced by the extended
 * `tests/authority-enforcement-import-isolation.test.ts`.
 *
 * POLICY NOTE (PR 3.3 mirrors current task-rbac assignment policy):
 *   The actor-role check for `assign` / `reassign` delegates to
 *   `canPerformTaskAction` in server/lib/task-rbac.ts, which currently
 *   permits `admin`, `vet`, and `senior_technician`. The Phase 3 ownership
 *   doctrine §3.3 mentions only "admin or vet" for forced reassignment.
 *   PR 3.3 deliberately mirrors the live policy to keep this foundation
 *   PR semantically inert. Any future tightening from
 *   senior_technician → admin/vet only must be a SEPARATE policy-change
 *   PR with shadow metrics first.
 */

import { createLogLimiter } from "../../log-safety.js";
import {
  canPerformMedicationTaskAction,
  canPerformTaskAction,
  type MedicationTaskAction,
  type TaskAction,
} from "../../task-rbac.js";
import { resolveTaskAssignmentEnforcementMode } from "./config.js";
import { taskAssignmentEnforceMetrics } from "./task-assignment.metrics.js";
import { emitTaskAssignmentDenialAudit } from "./task-assignment.audit.js";
import type {
  TaskAssignmentContext,
  TaskAssignmentDenyReason,
  TaskAssignmentEnforcementMode,
  TaskAssignmentVerdict,
} from "./result.js";

// Sampled shadow-mode log line so on-call can see at least one example per
// (clinic, actor, transition) per 5 minutes when shadow rates spike during
// rollout. Mirrors the pattern in stale.evaluator.ts.
const taskAssignmentShadowLogLimiter = createLogLimiter({
  dedupeWindowMs: 300_000,
  sampleRate: 1,
  maxEntries: 500,
});

/**
 * Pure helper: compute the would-deny reason for a context, or null when the
 * proposed transition is permitted. Exported for unit testing without going
 * through the full evaluator path (mode resolution + side effects).
 *
 * Precedence (deterministic; documented in the evaluator's tests):
 *   1. TARGET_CROSS_CLINIC
 *   2. TARGET_NOT_ACTIVE
 *   3. ACTOR_ROLE_NOT_PERMITTED
 *   4. TARGET_ROLE_NOT_PERMITTED
 *   5. OWNERSHIP_EXCLUSIVITY_VIOLATED  (acknowledge only)
 */
export function computeTaskAssignmentDeny(
  ctx: TaskAssignmentContext,
): TaskAssignmentDenyReason | null {
  // 1. Cross-clinic target — hard tenant invariant, evaluated first.
  if (ctx.target.clinicId !== ctx.clinicId) {
    return "TARGET_CROSS_CLINIC";
  }

  // 2. Target must be an active, non-soft-deleted user.
  if (ctx.target.status !== "active" || ctx.target.deletedAt !== null) {
    return "TARGET_NOT_ACTIVE";
  }

  // 3. Actor-role permission for the proposed transition.
  if (ctx.transition === "assign" || ctx.transition === "reassign") {
    const action: TaskAction = ctx.transition === "assign" ? "task.assign" : "task.reassign";
    if (!canPerformTaskAction(ctx.actor.role, action)) {
      return "ACTOR_ROLE_NOT_PERMITTED";
    }
  } else {
    // acknowledge: self-only. Even an admin cannot acknowledge on behalf of
    // someone else — that would create a phantom owner per doctrine §3.1.
    if (ctx.actor.userId !== ctx.target.userId) {
      return "ACTOR_ROLE_NOT_PERMITTED";
    }
  }

  // 4. Target-role permission to *hold* this task type. We probe the existing
  //    role-RBAC by asking "can this role start this kind of task?". For
  //    medication tasks we use canPerformMedicationTaskAction("med.start");
  //    for non-medication we use canPerformTaskAction("task.start").
  const targetCanStart = ctx.taskType === "medication"
    ? canPerformMedicationTaskAction(ctx.target.role, "med.start" satisfies MedicationTaskAction)
    : canPerformTaskAction(ctx.target.role, "task.start" satisfies TaskAction);
  if (!targetCanStart) {
    return "TARGET_ROLE_NOT_PERMITTED";
  }

  // 5. Acknowledge-only exclusivity: a task can have at most one active owner
  //    at a time (doctrine §3.1). Re-ack by the SAME user is allowed (treated
  //    as idempotent in the route handler). Reassign-to-current-owner is also
  //    allowed here per the user's decision B — the route handler may
  //    short-circuit it to a 200/unchanged response.
  if (ctx.transition === "acknowledge") {
    const current = ctx.currentOwnership.acknowledgedUserId;
    if (current !== null && current !== ctx.actor.userId) {
      return "OWNERSHIP_EXCLUSIVITY_VIOLATED";
    }
  }

  return null;
}

/**
 * Evaluator. Takes the context plus an optional injected mode resolver for
 * unit tests; production callers omit the second arg and use the env-backed
 * resolver in `enforcement/config.ts`.
 */
export async function evaluateTaskAssignment(
  ctx: TaskAssignmentContext,
  options: {
    modeResolver?: (clinicId: string) => Promise<TaskAssignmentEnforcementMode>;
  } = {},
): Promise<TaskAssignmentVerdict> {
  const mode = await (options.modeResolver ?? resolveTaskAssignmentEnforcementMode)(
    ctx.clinicId,
  );
  if (mode === "off") return { action: "allow" };

  const reason = computeTaskAssignmentDeny(ctx);
  if (reason === null) return { action: "allow" };

  if (mode === "shadow") {
    taskAssignmentEnforceMetrics.wouldHaveDenied(reason);
    const key = `task-assignment-shadow:${ctx.clinicId}:${ctx.actor.userId}:${ctx.transition}`;
    if (taskAssignmentShadowLogLimiter.shouldLog(key)) {
      console.warn(
        "[authority-task-assignment-shadow]",
        JSON.stringify({
          event: "task_assignment_would_have_denied",
          reason,
          transition: ctx.transition,
          clinicId: ctx.clinicId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          targetUserId: ctx.target.userId,
          targetRole: ctx.target.role,
          taskType: ctx.taskType,
          now: ctx.now.toISOString(),
        }),
      );
    }
    return { action: "allow" };
  }

  // mode === "enforce"
  taskAssignmentEnforceMetrics.denied(reason);
  emitTaskAssignmentDenialAudit({ ctx, reason });
  return { action: "deny", reason };
}
