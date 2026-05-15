/**
 * Phase 3 PR 3.6 — Stale-task-ownership evaluator types.
 *
 * Lives in its own file (rather than result.ts) to keep the PR 3.3 frozen
 * types untouched. The PR 7 stale/oprole types and the PR 3.3
 * task-assignment types in result.ts are unchanged by PR 3.6.
 *
 * The stale-task-ownership family observes whether an existing ownership
 * row is stale at evaluation time. It is conceptually distinct from the
 * task-assignment evaluator (which decides whether a proposed transition
 * is valid). The two families share no state, no metrics namespace, no
 * audit emitter, no config flag, and no imports — enforced by the
 * extended import-isolation test.
 *
 * Mode union (off | shadow | enforce):
 *   - off: evaluator returns allow without inspecting any field beyond
 *     clinicId (off-invariant); sweeper short-circuits before scanning.
 *   - shadow: evaluator never returns a deny / would-revoke verdict; if
 *     ownership IS stale, increments the would-have-revoked counter.
 *   - enforce: evaluator code path produces a `would_revoke` verdict for
 *     stale rows. PR 3.6 ships the verdict shape but DOES NOT wire any
 *     consumer that acts on it. The sweeper does NOT revoke in PR 3.6
 *     under any mode. Live revocation is the scope of PR 3.8 (per §13.3
 *     of the master plan).
 */

export type StaleTaskOwnershipEnforcementMode = "off" | "shadow" | "enforce";

/**
 * The single stale reason emitted by the PR 3.6 evaluator. Future PRs may
 * widen the union; PR 3.6 keeps it minimal.
 */
export type StaleTaskOwnershipReason = "STALE_OWNERSHIP";

/**
 * Pure-data context passed to the evaluator. Hydrated by the sweeper or
 * the wiring helper (in PR 3.7+). The evaluator never reads the database;
 * all fields are inputs.
 *
 * `ownerCheckInEndedAt` is null when the owner is currently checked in.
 * If the owner has never been checked in, the caller decides whether to
 * pass a null or a stub past-time; PR 3.6 documents both behaviors in
 * the evaluator tests.
 */
export interface StaleTaskOwnershipContext {
  clinicId: string;
  now: Date;
  /** Configurable per evaluator invocation. Default applied by the caller. */
  graceWindowMs: number;
  /**
   * Active-treatment safety floor (HARD INVARIANT, §11.4).
   * A task whose `updatedAt` is within this window from `now` is considered
   * actively under treatment. The evaluator NEVER returns a deny / would-
   * revoke verdict for such a task, regardless of mode or any other
   * condition. This invariant cannot be disabled by config.
   */
  activityWindowMs: number;
  /** Clinic-level flag from PR 3.6 sweeper plan §11.5. */
  emergencySuspend: boolean;
  /** Resolver health (PR 7 strategy A surface). */
  resolverOperational: boolean;
  task: {
    id: string;
    acknowledgedUserId: string;
    acknowledgedAt: Date | null;
    /** Raw appointment.status. The evaluator filters out terminal states. */
    status: string;
    /** Last mutation timestamp; drives the active-treatment safety floor. */
    updatedAt: Date;
  };
  /** Null when the owner is currently checked in. */
  ownerCheckInEndedAt: Date | null;
}

export interface StaleTaskOwnershipAllow {
  action: "allow";
  /**
   * Observability tag for the allow outcome. Used by the sweeper to bucket
   * stats; used by tests to assert mode-specific behavior.
   *
   * `WOULD_HAVE_REVOKED_SHADOW` is the shadow-mode variant for a stale row
   * that, in enforce mode, would have returned `would_revoke`. The
   * evaluator allows but increments the would-have-revoked counter
   * internally; the caller (sweeper / future wiring) uses the tag to
   * bucket the stat correctly without inspecting the mode.
   */
  protected?:
    | "ACTIVE_TREATMENT"
    | "EMERGENCY_SUSPEND"
    | "DEGRADED_MODE"
    | "OFF"
    | "NOT_STALE"
    | "WOULD_HAVE_REVOKED_SHADOW";
}

export interface StaleTaskOwnershipWouldRevoke {
  action: "would_revoke";
  reason: StaleTaskOwnershipReason;
}

export type StaleTaskOwnershipVerdict =
  | StaleTaskOwnershipAllow
  | StaleTaskOwnershipWouldRevoke;
