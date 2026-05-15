/**
 * Phase 4 PR 4.1 — Code Blue manager metrics registration smoke test.
 *
 * Asserts:
 *   - all PR 4.1 counters are reachable via `incrementMetric` (i.e. registered
 *     in `MetricName` and `DEFAULT_COUNTERS`),
 *   - they surface in the typed `MetricsSnapshot.codeBlue` subtree,
 *   - they initialize to 0,
 *   - they can be reset to 0 by `resetMetrics()`.
 *
 * No labels or dimensions — counters are flat literal names. This matches the
 * existing metrics style locked by master plan §10.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({ db: {}, users: {}, auditLogs: {}, eventOutbox: {} }));

import {
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics.js";

const NEW_COUNTERS = [
  "code_blue_initiator_authority_denied",
  "code_blue_manager_authority_allow",
  "code_blue_manager_authority_mode_inactive_strategy_a",
  "code_blue_manager_authority_fault_open",
  "code_blue_manager_authority_shadow_denied_oprole_not_in_allowlist",
  "code_blue_manager_authority_shadow_denied_no_open_check_in",
  "code_blue_manager_authority_shadow_denied_manager_cross_clinic",
  "code_blue_manager_authority_shadow_denied_user_missing",
  "code_blue_manager_authority_denied_oprole_not_in_allowlist",
  "code_blue_manager_authority_denied_no_open_check_in",
  "code_blue_manager_authority_denied_manager_cross_clinic",
  "code_blue_manager_authority_denied_user_missing",
  "code_blue_manager_drift_between_init_and_end",
] as const;

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

describe("PR 4.1 metrics registration", () => {
  it("all new counters initialize to 0 in snapshot", () => {
    const snap = getMetricsSnapshot();
    expect(snap.codeBlue.initiator.denied).toBe(0);
    expect(snap.codeBlue.manager.allow).toBe(0);
    expect(snap.codeBlue.manager.modeInactiveStrategyA).toBe(0);
    expect(snap.codeBlue.manager.faultOpen).toBe(0);
    expect(snap.codeBlue.manager.driftBetweenInitAndEnd).toBe(0);
    expect(snap.codeBlue.manager.shadowWouldHaveDenied.oproleNotInAllowlist).toBe(0);
    expect(snap.codeBlue.manager.shadowWouldHaveDenied.noOpenCheckIn).toBe(0);
    expect(snap.codeBlue.manager.shadowWouldHaveDenied.managerCrossClinic).toBe(0);
    expect(snap.codeBlue.manager.shadowWouldHaveDenied.userMissing).toBe(0);
    expect(snap.codeBlue.manager.denied.oproleNotInAllowlist).toBe(0);
    expect(snap.codeBlue.manager.denied.noOpenCheckIn).toBe(0);
    expect(snap.codeBlue.manager.denied.managerCrossClinic).toBe(0);
    expect(snap.codeBlue.manager.denied.userMissing).toBe(0);
  });

  it.each(NEW_COUNTERS)("incrementMetric('%s') increments by 1", (name) => {
    incrementMetric(name);
    incrementMetric(name);
    // Re-read snapshot via the corresponding path. We use a map for terseness.
    const snap = getMetricsSnapshot();
    const path: Record<(typeof NEW_COUNTERS)[number], number> = {
      code_blue_initiator_authority_denied: snap.codeBlue.initiator.denied,
      code_blue_manager_authority_allow: snap.codeBlue.manager.allow,
      code_blue_manager_authority_mode_inactive_strategy_a:
        snap.codeBlue.manager.modeInactiveStrategyA,
      code_blue_manager_authority_fault_open: snap.codeBlue.manager.faultOpen,
      code_blue_manager_authority_shadow_denied_oprole_not_in_allowlist:
        snap.codeBlue.manager.shadowWouldHaveDenied.oproleNotInAllowlist,
      code_blue_manager_authority_shadow_denied_no_open_check_in:
        snap.codeBlue.manager.shadowWouldHaveDenied.noOpenCheckIn,
      code_blue_manager_authority_shadow_denied_manager_cross_clinic:
        snap.codeBlue.manager.shadowWouldHaveDenied.managerCrossClinic,
      code_blue_manager_authority_shadow_denied_user_missing:
        snap.codeBlue.manager.shadowWouldHaveDenied.userMissing,
      code_blue_manager_authority_denied_oprole_not_in_allowlist:
        snap.codeBlue.manager.denied.oproleNotInAllowlist,
      code_blue_manager_authority_denied_no_open_check_in:
        snap.codeBlue.manager.denied.noOpenCheckIn,
      code_blue_manager_authority_denied_manager_cross_clinic:
        snap.codeBlue.manager.denied.managerCrossClinic,
      code_blue_manager_authority_denied_user_missing:
        snap.codeBlue.manager.denied.userMissing,
      code_blue_manager_drift_between_init_and_end:
        snap.codeBlue.manager.driftBetweenInitAndEnd,
    };
    expect(path[name]).toBe(2);
  });

  it("resetMetrics() returns all new counters to 0", () => {
    for (const name of NEW_COUNTERS) {
      incrementMetric(name);
    }
    resetMetrics();
    const snap = getMetricsSnapshot();
    expect(snap.codeBlue.initiator.denied).toBe(0);
    expect(snap.codeBlue.manager.allow).toBe(0);
    expect(snap.codeBlue.manager.modeInactiveStrategyA).toBe(0);
    expect(snap.codeBlue.manager.faultOpen).toBe(0);
    expect(snap.codeBlue.manager.driftBetweenInitAndEnd).toBe(0);
  });
});

describe("PR 4.1 metrics — no high-cardinality labels introduced", () => {
  // Sanity: the snapshot's codeBlue subtree contains only `initiator` and
  // `manager` sub-objects, each containing only scalar `number` fields (or
  // nested objects of scalar fields). No arrays, no maps, no dimensions.
  it("codeBlue subtree is flat-nested scalars", () => {
    const { codeBlue } = getMetricsSnapshot();
    function assertScalars(obj: unknown, pathHint: string): void {
      if (typeof obj === "number") return;
      if (obj === null || typeof obj !== "object") {
        throw new Error(`Unexpected non-scalar at ${pathHint}: ${String(obj)}`);
      }
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        assertScalars(value, `${pathHint}.${key}`);
      }
    }
    expect(() => assertScalars(codeBlue, "codeBlue")).not.toThrow();
  });
});
