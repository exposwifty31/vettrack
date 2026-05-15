/**
 * Phase 4 PR 4.1 — Code Blue manager authority evaluator. Foundation only.
 *
 * PURE function over `(mode, ctx)`. NO DB reads. NO cache reads. NO call to
 * `resolveAuthority` — the caller is responsible for resolving the **target
 * manager's** snapshot through the existing resolver framework and passing
 * the result as a `CodeBlueManagerLookup` discriminated union.
 *
 * Mode union: `off | shadow | enforce`. Default `off` (resolved in
 * `enforcement/config.ts::resolveCodeBlueManagerEnforcementMode`).
 *
 * Isolation: this file does NOT import `stale.evaluator.ts`,
 * `oprole.evaluator.ts`, `task-assignment.evaluator.ts`, or
 * `stale-task-ownership.evaluator.ts`. Enforced by the extended
 * `tests/authority-enforcement-import-isolation.test.ts`.
 *
 * Foundation-only contract (master plan §15 PR 4.1):
 *   - No route invokes this evaluator in PR 4.1.
 *   - Counters and audit kinds are registered but only move under explicit
 *     test invocations.
 *   - PR 4.2 wires the evaluator at initiation. PR 4.3 wires it at end.
 *
 * Fail-open posture (master plan §9, DECISION-2):
 *   When the caller's lookup is `resolver_fault`, the evaluator returns
 *   `allow` with `protected: "FAULT_OPEN"` in BOTH shadow and enforce
 *   modes, emits a severity=high audit, and increments a dedicated counter.
 *   Rationale: false-deny in a real cardiac arrest is worse than false-allow
 *   followed by reconciliation.
 *
 * Strategy A precondition (master plan §5 invariant 5):
 *   When `AUTHORITY_USE_CHECKIN_PATH` is off or the user has no check-in row
 *   AND the resolver returned a "legacy / no-check-in" reason, the evaluator
 *   returns `mode_inactive` (allow + `protected: "MODE_INACTIVE_STRATEGY_A"`).
 *   This prevents silent no-ops in Strategy A clinics from being conflated
 *   with real "manager not eligible" denies.
 */

import { isCodeBlueEligibleOperationalRole } from "../../../../shared/code-blue-authority.js";
import type { AuthoritySnapshot } from "../../../../shared/authority.js";
import { resolveCodeBlueManagerEnforcementMode } from "./config.js";
import {
  emitCodeBlueManagerDenied,
  emitCodeBlueManagerFaultOpen,
  emitCodeBlueManagerShadowDenied,
} from "./code-blue-manager.audit.js";
import { codeBlueManagerMetrics } from "./code-blue-manager.metrics.js";
import type {
  CodeBlueManagerContext,
  CodeBlueManagerDenyReason,
  CodeBlueManagerEnforcementMode,
  CodeBlueManagerLookup,
  CodeBlueManagerVerdict,
} from "./code-blue-manager.types.js";

/**
 * The set of resolver `AuthorityReason` codes that mean "this clinic has not
 * adopted the check-in path for this user". When a snapshot carries one of
 * these reasons AND `operationalRole === null`, the evaluator returns
 * `mode_inactive` rather than denying for `NO_OPEN_CHECK_IN` — Strategy A
 * clinics must not get drowned in deny noise.
 *
 * Locked at master-plan §5 invariant 5. Adding a code here is a policy
 * change; remove with care.
 */
const STRATEGY_A_REASONS: ReadonlySet<AuthoritySnapshot["reason"]> = new Set([
  "EZSHIFT_ACTIVE",
  "EZSHIFT_NONE",
  "SHIFT_ROLE_NOT_CLINICAL",
  "STUDENT_NEVER_ELEVATED",
  "LEGACY_ADMIN_NO_CLINICAL",
  "NOT_CHECKED_IN",
]);

function isStrategyAInactive(snapshot: AuthoritySnapshot): boolean {
  return (
    snapshot.operationalRole === null && STRATEGY_A_REASONS.has(snapshot.reason)
  );
}

/**
 * Pure helper: compute the would-deny reason for a context (snapshot-resolved
 * branch only), or null when the manager passes. Exported for unit testing
 * without going through the full evaluator path (mode resolution + side
 * effects).
 *
 * NOTE: this helper covers only the `snapshot` lookup branch. The
 * `user_missing`, `cross_clinic`, and `resolver_fault` branches are handled
 * directly by the evaluator (each maps to a fixed verdict).
 */
export function computeCodeBlueManagerSnapshotDeny(
  snapshot: AuthoritySnapshot,
): { kind: "allow" } | { kind: "mode_inactive" } | { kind: "deny"; reason: CodeBlueManagerDenyReason } {
  if (isStrategyAInactive(snapshot)) {
    return { kind: "mode_inactive" };
  }
  if (snapshot.operationalRole === null) {
    return { kind: "deny", reason: "NO_OPEN_CHECK_IN" };
  }
  if (!isCodeBlueEligibleOperationalRole(snapshot.operationalRole)) {
    return { kind: "deny", reason: "OPROLE_NOT_IN_CB_ALLOWLIST" };
  }
  return { kind: "allow" };
}

function lookupToReason(
  lookup: CodeBlueManagerLookup,
): CodeBlueManagerDenyReason | null {
  switch (lookup.kind) {
    case "user_missing":
      return "USER_MISSING";
    case "cross_clinic":
      return "MANAGER_CROSS_CLINIC";
    case "snapshot":
    case "resolver_fault":
      return null;
  }
}

export interface EvaluateCodeBlueManagerOptions {
  modeResolver?: (
    clinicId: string,
    endpoint: CodeBlueManagerContext["endpoint"],
  ) => Promise<CodeBlueManagerEnforcementMode>;
}

export async function evaluateCodeBlueManagerAuthority(
  ctx: CodeBlueManagerContext,
  options: EvaluateCodeBlueManagerOptions = {},
): Promise<CodeBlueManagerVerdict> {
  const resolver = options.modeResolver ?? resolveCodeBlueManagerEnforcementMode;
  const mode = await resolver(ctx.clinicId, ctx.endpoint);

  if (mode === "off") {
    return { action: "allow", protected: "MODE_OFF" };
  }

  // Fail-open posture: resolver fault is allow-in-both-modes, with a dedicated
  // severity=high audit and counter. Handled before any other branch so the
  // fail-open invariant is observable to tests with a single short path.
  if (ctx.lookup.kind === "resolver_fault") {
    codeBlueManagerMetrics.faultOpen();
    emitCodeBlueManagerFaultOpen(ctx);
    return { action: "allow", protected: "FAULT_OPEN" };
  }

  // Caller-hydrated lookup failures (user_missing, cross_clinic). The snapshot
  // branch is handled separately below.
  const lookupReason = lookupToReason(ctx.lookup);
  if (lookupReason !== null) {
    if (mode === "shadow") {
      codeBlueManagerMetrics.shadowWouldHaveDenied(lookupReason);
      emitCodeBlueManagerShadowDenied({ ctx, reason: lookupReason });
      return { action: "allow", protected: "SHADOW_WOULD_HAVE_DENIED" };
    }
    // mode === "enforce"
    codeBlueManagerMetrics.denied(lookupReason);
    emitCodeBlueManagerDenied({ ctx, reason: lookupReason });
    return { action: "deny", reason: lookupReason };
  }

  // ctx.lookup.kind === "snapshot"
  if (ctx.lookup.kind !== "snapshot") {
    // Exhaustiveness guard — unreachable if the union is well-formed. Treated
    // as fail-open to preserve the master-plan failure-mode contract.
    codeBlueManagerMetrics.faultOpen();
    emitCodeBlueManagerFaultOpen(ctx);
    return { action: "allow", protected: "FAULT_OPEN" };
  }
  const snapshotResult = computeCodeBlueManagerSnapshotDeny(ctx.lookup.snapshot);

  if (snapshotResult.kind === "mode_inactive") {
    codeBlueManagerMetrics.modeInactiveStrategyA();
    return { action: "allow", protected: "MODE_INACTIVE_STRATEGY_A" };
  }

  if (snapshotResult.kind === "allow") {
    codeBlueManagerMetrics.allow();
    return { action: "allow", protected: "ALLOWLIST_OK" };
  }

  // snapshotResult.kind === "deny"
  const reason = snapshotResult.reason;
  if (mode === "shadow") {
    codeBlueManagerMetrics.shadowWouldHaveDenied(reason);
    emitCodeBlueManagerShadowDenied({ ctx, reason });
    return { action: "allow", protected: "SHADOW_WOULD_HAVE_DENIED" };
  }
  // mode === "enforce"
  codeBlueManagerMetrics.denied(reason);
  emitCodeBlueManagerDenied({ ctx, reason });
  return { action: "deny", reason };
}
