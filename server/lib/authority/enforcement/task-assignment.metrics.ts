/**
 * Phase 3 PR 3.3 — Task-assignment evaluator metric helpers.
 *
 * Mirrors the PR 7 pattern in metrics.ts (stale/oprole helpers): kind-
 * namespaced thin wrappers around `incrementMetric`. Each reason has its
 * own counter so dashboards can see the per-reason distribution; the helper
 * maps `TaskAssignmentDenyReason` to the correct counter name.
 *
 * Foundation-only: PR 3.3 wires the evaluator but no route binds it yet.
 * These counters move only when an explicit test invokes the evaluator, or
 * when PR 3.4 wires it into routes.
 */

import { incrementMetric } from "../../metrics.js";
import type { TaskAssignmentDenyReason } from "./result.js";

function wouldHaveDeniedMetric(reason: TaskAssignmentDenyReason): string {
  switch (reason) {
    case "ACTOR_ROLE_NOT_PERMITTED":
      return "task_assignment_enforce_would_have_denied_actor_role";
    case "TARGET_CROSS_CLINIC":
      return "task_assignment_enforce_would_have_denied_target_cross_clinic";
    case "TARGET_NOT_ACTIVE":
      return "task_assignment_enforce_would_have_denied_target_not_active";
    case "TARGET_ROLE_NOT_PERMITTED":
      return "task_assignment_enforce_would_have_denied_target_role";
    case "OWNERSHIP_EXCLUSIVITY_VIOLATED":
      return "task_assignment_enforce_would_have_denied_exclusivity";
  }
}

function deniedMetric(reason: TaskAssignmentDenyReason): string {
  switch (reason) {
    case "ACTOR_ROLE_NOT_PERMITTED":
      return "task_assignment_enforce_denied_actor_role";
    case "TARGET_CROSS_CLINIC":
      return "task_assignment_enforce_denied_target_cross_clinic";
    case "TARGET_NOT_ACTIVE":
      return "task_assignment_enforce_denied_target_not_active";
    case "TARGET_ROLE_NOT_PERMITTED":
      return "task_assignment_enforce_denied_target_role";
    case "OWNERSHIP_EXCLUSIVITY_VIOLATED":
      return "task_assignment_enforce_denied_exclusivity";
  }
}

export const taskAssignmentEnforceMetrics = {
  wouldHaveDenied(reason: TaskAssignmentDenyReason): void {
    incrementMetric(wouldHaveDeniedMetric(reason));
  },
  denied(reason: TaskAssignmentDenyReason): void {
    incrementMetric(deniedMetric(reason));
  },
};
