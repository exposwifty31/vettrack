/**
 * Phase 2.5 PR 7 — Authority enforcement shared result types.
 *
 * The only file (besides config.ts) that BOTH evaluators may import. The
 * stale and OPROLE evaluators MUST NOT import each other — isolation is
 * load-bearing (plan §3.1) and verified by tests/authority-enforcement-import-isolation.test.ts.
 */

import type { OperationalRole } from "../../../../shared/authority.js";
import type { OpenClinicalCheckInRow } from "../../check-in-resolution.js";

/**
 * Enforcement mode union.
 *
 * - Stale evaluator supports "off | shadow | enforce" (§4.1).
 * - OPROLE evaluator supports "off | enforce" only (§4.1 / §5.3). PR 5.3
 *   owns OPROLE shadow telemetry via authority_oprole_shadow_* counters and
 *   scheduleOperationalRoleShadowValidation. PR 7 does not duplicate that
 *   signal — there is no PR-7-owned OPROLE shadow mode.
 *
 * Each evaluator validates the modes it accepts at the type level via
 * its own narrower union (StaleEnforcementMode / OproleEnforcementMode).
 */
export type EnforcementMode = "off" | "shadow" | "enforce";
export type StaleEnforcementMode = "off" | "shadow" | "enforce";
export type OproleEnforcementMode = "off" | "enforce";

/**
 * Context passed to each evaluator. Pure data — never includes Express req,
 * never includes route or request-scoped fields. Side-effect invariant (§3.6)
 * is enforced by the absence of req-shaped data here.
 */
export interface EnforcementContext {
  clinicId: string;
  userId: string;
  now: Date;
  checkIn: OpenClinicalCheckInRow;
}

/**
 * Verdict returned by each evaluator. Exactly one of "allow" or "deny" per
 * resolution (§3.5 single-denial invariant). Shadow-mode would-deny is
 * recorded as a counter inside the evaluator itself and returns "allow" —
 * the resolver never sees a third action.
 */
export interface EnforcementAllow {
  action: "allow";
}

export interface EnforcementDeny {
  action: "deny";
  reason: "CHECKED_IN_STALE" | "CHECKED_IN_OPROLE_REVOKED";
}

export type EnforcementVerdict = EnforcementAllow | EnforcementDeny;

/**
 * Operational-role values that may appear in checkIn.operationalRole and
 * therefore in the allowlist comparison. Mirrors the non-null branch of
 * OperationalRole; declared here so the evaluators don't have to repeat the
 * Exclude.
 */
export type NonNullOperationalRole = Exclude<OperationalRole, null>;

// ---------------------------------------------------------------------------
// Phase 3 PR 3.3 — Task-assignment evaluator types.
//
// Additive only. The existing stale / OPROLE types above are untouched.
// The task-assignment evaluator has different inputs (a proposed transition
// rather than a check-in row) and different verdict reasons, so it gets its
// own context and verdict shapes rather than overloading the PR 7 ones.
// ---------------------------------------------------------------------------

export type TaskAssignmentEnforcementMode = "off" | "shadow" | "enforce";

/** Which ownership-lifecycle transition is being evaluated. */
export type TaskAssignmentTransition = "assign" | "reassign" | "acknowledge";

/**
 * Target user fields the evaluator needs to reason about. The route handler
 * (PR 3.4) is responsible for hydrating these from vt_users — the evaluator
 * never reads the database. Per PR 3.3 hard constraint: "no DB reads inside
 * evaluator unless already explicitly provided via input."
 */
export interface TaskAssignmentTargetUser {
  userId: string;
  /** Raw `vt_users.role`. */
  role: string;
  /** Target user's clinic — used to enforce same-clinic invariant. */
  clinicId: string;
  /** Raw `vt_users.status` (e.g. "active", "blocked", "pending"). */
  status: string;
  /** `vt_users.deleted_at`; non-null means soft-deleted. */
  deletedAt: Date | null;
}

/**
 * Pure-data context passed to `evaluateTaskAssignment`. No Express request,
 * no DB handle, no cache — the evaluator must remain side-effect-free aside
 * from documented metrics + audit emissions.
 */
export interface TaskAssignmentContext {
  clinicId: string;
  now: Date;
  transition: TaskAssignmentTransition;
  actor: {
    userId: string;
    /** Raw `vt_users.role` of the actor performing the mutation. */
    role: string;
  };
  target: TaskAssignmentTargetUser;
  /** `null` for non-typed maintenance/inspection rows in the schema. */
  taskType: "maintenance" | "repair" | "inspection" | "medication" | null;
  currentOwnership: {
    acknowledgedUserId: string | null;
    /** Raw appointment.status. */
    status: string;
  };
}

/**
 * Stable denial reasons. Each one maps 1:1 to a wouldHaveDenied / denied
 * metric counter (see task-assignment.metrics.ts) and to the rate-limit
 * bucket in the audit emitter.
 */
export type TaskAssignmentDenyReason =
  | "ACTOR_ROLE_NOT_PERMITTED"
  | "TARGET_CROSS_CLINIC"
  | "TARGET_NOT_ACTIVE"
  | "TARGET_ROLE_NOT_PERMITTED"
  | "OWNERSHIP_EXCLUSIVITY_VIOLATED";

export interface TaskAssignmentAllow {
  action: "allow";
}
export interface TaskAssignmentDeny {
  action: "deny";
  reason: TaskAssignmentDenyReason;
}
export type TaskAssignmentVerdict = TaskAssignmentAllow | TaskAssignmentDeny;
