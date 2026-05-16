/**
 * Phase 5 PR 5.2 — Clinical-invariant evaluator metric helpers.
 *
 * Sibling file pattern from PR 3.6 (`stale-task-ownership.metrics.ts`)
 * and PR 3.3 (`task-assignment.metrics.ts`). The clinical-invariant
 * family has its own metrics namespace so its observability cannot
 * starve or be starved by other enforcement families.
 *
 * Foundation+shadow-only in PR 5.2: only the `_would_have_blocked*`
 * counters land here. PR 5.7 adds the enforce-only counters
 * (`_blocked_total`, `_orphan_reason_*`, `_emergency_bypass_total`,
 * `_fail_open_total`, `_fail_closed_total`,
 * `_evaluator_failure_total`) in its own additive edit.
 *
 * Cardinality contract (Phase 5 plan §10.2): zero high-cardinality
 * labels. One counter per `(reason, mode)` family. Reason buckets are
 * flat counter names (not labels) to match
 * `authority_resolution_source_*` and every prior enforcement family.
 */

import { incrementMetric } from "../../metrics.js";
import type { OrphanReasonCode } from "../../dispense-order-validation.js";

export const clinicalInvariantMetrics = {
  /**
   * Increment the shadow-mode total: one tick per mutation request that
   * produces a non-empty `orphanLines` array. Independent of how many
   * lines or reasons were present in the request — those are tracked
   * separately by `wouldHaveBlockedReason` below.
   */
  wouldHaveBlocked(): void {
    incrementMetric("clinical_invariant_would_have_blocked");
  },
  /**
   * Increment exactly one of the four per-reason shadow counters.
   * Callers should call this once per **unique** reason observed
   * across all orphan lines in the request — not once per line — to
   * keep the counter shape aligned with the `(reason, mode)` family
   * contract.
   *
   * Switch is exhaustive over the frozen `OrphanReasonCode` union
   * (Phase 5 plan §19.27 — union is frozen for Phase 5). Adding a
   * new reason code would surface as a TypeScript exhaustiveness
   * error here and at the evaluator call site.
   */
  wouldHaveBlockedReason(reason: OrphanReasonCode): void {
    switch (reason) {
      case "NO_PATIENT_LINKED":
        incrementMetric("clinical_invariant_would_have_blocked_no_patient_linked");
        return;
      case "NO_ACTIVE_HOSPITALIZATION":
        incrementMetric("clinical_invariant_would_have_blocked_no_active_hospitalization");
        return;
      case "NO_ACTIVE_ORDER":
        incrementMetric("clinical_invariant_would_have_blocked_no_active_order");
        return;
      case "QUANTITY_EXCEEDS_ORDER":
        incrementMetric("clinical_invariant_would_have_blocked_quantity_exceeds_order");
        return;
    }
  },
};
