/**
 * Phase 4 PR 4.1 — Code Blue manager evaluator metric helpers.
 *
 * Sibling file pattern from PR 3.3 (task-assignment.metrics.ts) and PR 3.6
 * (stale-task-ownership.metrics.ts). Independent namespace so this family's
 * observability cannot starve or be starved by the other enforcement families.
 *
 * Metrics style — match existing codebase (master plan §10): flat literal
 * counter names registered in the `MetricName` union in `server/lib/metrics.ts`.
 * No labels, no dimensions, no high-cardinality clinic dimensions.
 *
 * Tombstones (asserted 0 in PR 4.1 tests):
 *   - `code_blue_initiator_authority_denied` — incremented by PR 4.2 wiring.
 *   - `code_blue_manager_drift_between_init_and_end` — incremented by PR 4.3.
 *   - `code_blue_manager_authority_denied_*` — incremented when a clinic is
 *     in enforce mode, which requires the wiring landed by PR 4.2 / PR 4.3.
 */

import { incrementMetric } from "../../metrics.js";
import type { CodeBlueManagerDenyReason } from "./code-blue-manager.types.js";

function shadowDeniedMetric(reason: CodeBlueManagerDenyReason): string {
  switch (reason) {
    case "OPROLE_NOT_IN_CB_ALLOWLIST":
      return "code_blue_manager_authority_shadow_denied_oprole_not_in_allowlist";
    case "NO_OPEN_CHECK_IN":
      return "code_blue_manager_authority_shadow_denied_no_open_check_in";
    case "MANAGER_CROSS_CLINIC":
      return "code_blue_manager_authority_shadow_denied_manager_cross_clinic";
    case "USER_MISSING":
      return "code_blue_manager_authority_shadow_denied_user_missing";
  }
}

function deniedMetric(reason: CodeBlueManagerDenyReason): string {
  switch (reason) {
    case "OPROLE_NOT_IN_CB_ALLOWLIST":
      return "code_blue_manager_authority_denied_oprole_not_in_allowlist";
    case "NO_OPEN_CHECK_IN":
      return "code_blue_manager_authority_denied_no_open_check_in";
    case "MANAGER_CROSS_CLINIC":
      return "code_blue_manager_authority_denied_manager_cross_clinic";
    case "USER_MISSING":
      return "code_blue_manager_authority_denied_user_missing";
  }
}

export const codeBlueManagerMetrics = {
  /** Snapshot-resolved manager passed the allowlist check. */
  allow(): void {
    incrementMetric("code_blue_manager_authority_allow");
  },
  /**
   * Strategy A precondition: the clinic has not adopted the check-in path
   * (or this user has no check-in row with a reason in the legacy set). The
   * evaluator returns allow without emitting any audit. Surfacing this as a
   * dedicated counter prevents Strategy A clinics from drowning the shadow
   * signal in deny noise.
   */
  modeInactiveStrategyA(): void {
    incrementMetric("code_blue_manager_authority_mode_inactive_strategy_a");
  },
  /**
   * Resolver fault (the caller's resolveAuthority call threw). Fail-open
   * posture per master plan §9 / DECISION-2. Emitted in BOTH shadow and
   * enforce modes.
   */
  faultOpen(): void {
    incrementMetric("code_blue_manager_authority_fault_open");
  },
  /** Shadow-mode would-have-denied, split by reason. */
  shadowWouldHaveDenied(reason: CodeBlueManagerDenyReason): void {
    incrementMetric(shadowDeniedMetric(reason));
  },
  /** Enforce-mode deny, split by reason. */
  denied(reason: CodeBlueManagerDenyReason): void {
    incrementMetric(deniedMetric(reason));
  },
  /**
   * Tombstone — incremented by PR 4.2 wiring at the initiator clinical-gate
   * denial site. PR 4.1 leaves this at 0.
   */
  initiatorDenied(): void {
    incrementMetric("code_blue_initiator_authority_denied");
  },
  /**
   * Tombstone — incremented by PR 4.3 wiring when init→end manager-eligibility
   * crosses. PR 4.1 leaves this at 0. This is the headline Phase 4 signal.
   */
  driftBetweenInitAndEnd(): void {
    incrementMetric("code_blue_manager_drift_between_init_and_end");
  },
};
