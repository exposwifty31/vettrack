/**
 * Phase 3 PR 3.6 — Stale-task-ownership evaluator + sweeper metric helpers.
 *
 * Sibling file pattern from PR 3.3 (task-assignment.metrics.ts). The
 * stale-task-ownership family has its own metrics namespace so observability
 * cannot starve or be starved by the task-assignment / PR 7 stale / PR 7
 * oprole families.
 *
 * Foundation-only (PR 3.6): the `revoked` counter is a tombstone — PR 3.6
 * ships no consumer that increments it. Live revocation is PR 3.8 scope.
 */

import { incrementMetric } from "../../metrics.js";

export const staleTaskOwnershipMetrics = {
  /** Sweeper scanned one candidate task (raw row touched by the sweep). */
  scanned(): void {
    incrementMetric("stale_task_ownership_scanned");
  },
  /** Evaluator returned a stale verdict in shadow mode. */
  wouldHaveRevoked(): void {
    incrementMetric("stale_task_ownership_would_have_revoked");
  },
  /**
   * Active-treatment safety floor engaged. Recently-updated in-progress task
   * was protected from any would-revoke verdict (HARD invariant §11.4). The
   * counter must be non-zero in any clinic with in-progress treatment work
   * if the sweeper is running.
   */
  activeTreatmentProtected(): void {
    incrementMetric("stale_task_ownership_active_treatment_protected");
  },
  /** Clinic is in emergency-suspend; evaluator and sweeper short-circuit. */
  emergencySuspendSkip(): void {
    incrementMetric("stale_task_ownership_emergency_suspend_skip");
  },
  /** Resolver degraded; evaluator and sweeper pause. */
  degradedModePause(): void {
    incrementMetric("stale_task_ownership_degraded_mode_pause");
  },
  /** Sweeper observed lease contention and is retrying with backoff. */
  leaseContentionRetry(): void {
    incrementMetric("stale_task_ownership_lease_contention_retry");
  },
  /**
   * Tombstone counter. PR 3.6 must NEVER increment this. Asserted to remain
   * 0 in the PR 3.6 test suite. If it ever increments in production before
   * PR 3.8 ships, an isolation invariant has been broken.
   */
  revoked(): void {
    incrementMetric("stale_task_ownership_revoked");
  },
};
