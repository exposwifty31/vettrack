/**
 * Phase 3 PR 3.6 — Stale-task-ownership evaluator. Foundation only.
 *
 * PURE function over the input context. NO DB reads. NO cache reads. NO
 * mutation of task state. Side effects are limited to the documented
 * metric increments (stale-task-ownership.metrics.ts) and, in shadow
 * mode, the rate-limited audit emission (stale-task-ownership.audit.ts).
 *
 * Mode union: `off | shadow | enforce`. Default `off` (resolved by
 * `enforcement/config.ts::resolveStaleTaskOwnershipEnforcementMode`).
 *
 * Isolation (mechanically enforced by the extended import-isolation test):
 *   - DOES NOT import `stale.evaluator.ts` (PR 7 stale check-in family).
 *   - DOES NOT import `oprole.evaluator.ts` (PR 7 oprole family).
 *   - DOES NOT import `task-assignment.evaluator.ts` (PR 3.3 family).
 *   - DOES NOT share sibling files with any other evaluator family.
 *
 * The active-treatment safety floor (§11.4) is implemented BEFORE the
 * stale determination. A task whose `updatedAt` is within the
 * `activityWindowMs` from `now` returns allow with `protected:
 * "ACTIVE_TREATMENT"` — REGARDLESS OF MODE (including enforce). This
 * invariant cannot be disabled.
 *
 * PR 3.6 ships the verdict shape for all three modes. NO CONSUMER in
 * PR 3.6 acts on a `would_revoke` verdict. Live revocation is PR 3.8
 * scope (per master plan §13.3 asymmetry).
 */

import { resolveStaleTaskOwnershipEnforcementMode } from "./config.js";
import { staleTaskOwnershipMetrics } from "./stale-task-ownership.metrics.js";
import { emitStaleTaskOwnershipWouldHaveRevokedAudit } from "./stale-task-ownership.audit.js";
import type {
  StaleTaskOwnershipContext,
  StaleTaskOwnershipEnforcementMode,
  StaleTaskOwnershipVerdict,
} from "./stale-task-ownership.types.js";

/**
 * Task statuses that are eligible for stale-ownership evaluation. Terminal
 * states (completed / cancelled / no_show) are never stale candidates.
 */
const ACTIVE_TASK_STATUSES: ReadonlySet<string> = new Set([
  "assigned",
  "scheduled",
  "arrived",
  "in_progress",
  "approved",
]);

/**
 * Pure helper: would the task be stale at `now` ignoring mode? Exported for
 * unit testing without going through the full evaluator. Returns `null`
 * when ownership is not stale (any reason); otherwise the reason.
 *
 * Note: the active-treatment safety floor is checked HERE — the helper
 * never reports stale for a task within the activity window.
 */
export function classifyStaleTaskOwnership(
  ctx: StaleTaskOwnershipContext,
): "stale" | "not_stale" | "active_treatment_protected" | "not_in_active_status" {
  // Active-treatment safety floor — HARD INVARIANT (§11.4). Evaluated FIRST
  // among the staleness checks so it supersedes any deny verdict.
  const sinceUpdateMs = ctx.now.getTime() - ctx.task.updatedAt.getTime();
  if (sinceUpdateMs <= ctx.activityWindowMs) {
    return "active_treatment_protected";
  }

  // Terminal-state guard: only active-status rows can be stale candidates.
  if (!ACTIVE_TASK_STATUSES.has(ctx.task.status)) {
    return "not_in_active_status";
  }

  // Owner is currently checked in → not stale.
  if (ctx.ownerCheckInEndedAt === null) {
    return "not_stale";
  }

  // Owner has been checked out, but within the grace window → not stale.
  const sinceCheckoutMs = ctx.now.getTime() - ctx.ownerCheckInEndedAt.getTime();
  if (sinceCheckoutMs <= ctx.graceWindowMs) {
    return "not_stale";
  }

  return "stale";
}

export interface EvaluateStaleTaskOwnershipOptions {
  /** Test seam: inject a mode resolver. Production omits and uses env. */
  modeResolver?: (clinicId: string) => Promise<StaleTaskOwnershipEnforcementMode>;
}

export async function evaluateStaleTaskOwnership(
  ctx: StaleTaskOwnershipContext,
  options: EvaluateStaleTaskOwnershipOptions = {},
): Promise<StaleTaskOwnershipVerdict> {
  const resolver = options.modeResolver ?? resolveStaleTaskOwnershipEnforcementMode;
  const mode = await resolver(ctx.clinicId);
  if (mode === "off") {
    return { action: "allow", protected: "OFF" };
  }

  // Emergency-suspend bypass — per §11.5 / §13.10, clinic-level flag
  // supersedes the evaluator regardless of mode.
  if (ctx.emergencySuspend) {
    staleTaskOwnershipMetrics.emergencySuspendSkip();
    return { action: "allow", protected: "EMERGENCY_SUSPEND" };
  }

  // Degraded-mode pause — when the resolver is unreachable, evaluator
  // returns allow + counter. Live revocation NEVER occurs during degraded
  // operation.
  if (!ctx.resolverOperational) {
    staleTaskOwnershipMetrics.degradedModePause();
    return { action: "allow", protected: "DEGRADED_MODE" };
  }

  const classification = classifyStaleTaskOwnership(ctx);

  if (classification === "active_treatment_protected") {
    // HARD INVARIANT §11.4 — overrides any would-revoke verdict in any mode.
    staleTaskOwnershipMetrics.activeTreatmentProtected();
    return { action: "allow", protected: "ACTIVE_TREATMENT" };
  }

  if (classification !== "stale") {
    return { action: "allow", protected: "NOT_STALE" };
  }

  // Ownership is stale. Mode-specific handling.
  if (mode === "shadow") {
    staleTaskOwnershipMetrics.wouldHaveRevoked();
    emitStaleTaskOwnershipWouldHaveRevokedAudit({
      clinicId: ctx.clinicId,
      taskId: ctx.task.id,
      ownerUserId: ctx.task.acknowledgedUserId,
      ownerCheckInEndedAt: ctx.ownerCheckInEndedAt,
      taskUpdatedAt: ctx.task.updatedAt,
      graceWindowMs: ctx.graceWindowMs,
      activityWindowMs: ctx.activityWindowMs,
    });
    return { action: "allow", protected: "WOULD_HAVE_REVOKED_SHADOW" };
  }

  // mode === "enforce" — produce the verdict shape. PR 3.6 SHIPS this
  // branch but NO consumer in PR 3.6 acts on it. Live revocation arrives
  // in PR 3.8 (master plan §13.3).
  staleTaskOwnershipMetrics.wouldHaveRevoked();
  return { action: "would_revoke", reason: "STALE_OWNERSHIP" };
}
