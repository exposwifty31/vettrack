/**
 * Phase 5 PR 5.2 — Clinical-invariant evaluator (pure wrapper).
 *
 * Thin wrapper around the existing pure validation utility
 * `evaluateDispenseAgainstOrders` from `dispense-order-validation.ts`.
 * The evaluator NEVER opens a transaction, NEVER mutates the
 * transaction state, and NEVER writes any audit row — it is read-only
 * inside the caller-provided `tx` (Phase 5 plan §5 CI-3, CI-24).
 *
 * Mode dispatch:
 *   - off: short-circuit, no clinical-validation queries, no counters
 *     beyond the resolver's own cached config probe (Phase 5 plan §5
 *     CI-27). This is a defensive evaluator-side guard; the wired
 *     call site is the **primary** off-mode short-circuit per plan
 *     §15 PR 5.3 / 5.4 — the wiring layer MUST NOT invoke the
 *     evaluator on the request path when mode is off. The evaluator
 *     keeps this branch so unit tests can exercise mode dispatch
 *     without rebuilding the wiring layer.
 *   - emergency carve-out (CI-7): short-circuits BEFORE the
 *     evaluator's DB read so an `isEmergency=true` + `bypassReason`
 *     request never triggers a SELECT regardless of mode. Returns
 *     allow with disposition `EMERGENCY_BYPASS`.
 *   - shadow: runs `evaluateDispenseAgainstOrders`; on orphans
 *     present, increments the shadow `_would_have_blocked*` counters
 *     once per unique reason; returns allow with disposition
 *     `WOULD_HAVE_BLOCKED_SHADOW`.
 *   - enforce: runs `evaluateDispenseAgainstOrders`; on orphans
 *     present, returns `{ action: "deny", reason:
 *     "ORPHAN_DISPENSE_BLOCKED", orphanLines }`. PR 5.2 does NOT emit
 *     a denial audit and does NOT increment any enforce-only counters
 *     — both land in PR 5.7 (the audit kind + emitter + the
 *     `_blocked_total` / per-reason / `_emergency_bypass_total` /
 *     `_fail_open_total` / `_fail_closed_total` /
 *     `_evaluator_failure_total` literals all land in PR 5.7 per
 *     Phase 5 plan §15).
 *
 * Wiring layer ownership of runtime control flow (Phase 5 plan §5
 * CI-20): try/catch / fail-mode / Strategy-A degrade semantics are
 * the wiring layer's responsibility (PR 5.3 / 5.4) — NOT this
 * evaluator's. The evaluator MAY throw if `evaluateDispenseAgainstOrders`
 * throws; the wiring layer catches that throw exactly once and
 * applies fail-open / fail-closed semantics (CI-16, CI-22).
 *
 * Single-attempt validation (CI-16): the evaluator is invoked at
 * most once per mutation request. No retries, no recursion, no
 * repeated DB probes. Enforced at the wiring layer; the evaluator
 * itself never re-invokes `evaluateDispenseAgainstOrders`.
 *
 * Isolation (mechanically enforced by the extended import-isolation
 * test in PR 5.1): this file imports only its own types / metrics
 * siblings, the shared resolver (`./clinical-invariant.config.js`),
 * and the pure validation utility
 * (`../../dispense-order-validation.js`). It does NOT import any
 * other evaluator family file.
 */

import { resolveClinicalInvariantEnforcementMode } from "./clinical-invariant.config.js";
import { clinicalInvariantMetrics } from "./clinical-invariant.metrics.js";
import type {
  ClinicalInvariantContext,
  ClinicalInvariantEnforcementMode,
  ClinicalInvariantVerdict,
} from "./clinical-invariant.types.js";
import {
  evaluateDispenseAgainstOrders,
  type OrphanReasonCode,
} from "../../dispense-order-validation.js";

export interface EvaluateClinicalInvariantOptions {
  /**
   * Optional mode resolver injection — used by the unit-test suite to
   * drive deterministic mode dispatch without round-tripping through
   * the cached `vt_server_config` resolver. The wired call site in
   * PR 5.3 / 5.4 does NOT pass this option; it lets the evaluator
   * resolve through the production resolver.
   */
  modeResolver?: () => Promise<ClinicalInvariantEnforcementMode>;
}

/**
 * Phase 5 PR 5.2 — clinical-invariant evaluator entry point.
 *
 * See file header for the full semantics. Returns a discriminated
 * union verdict; the caller (PR 5.3 / 5.4 wiring) is responsible for
 * translating an `action: "deny"` into the 422 response in PR 5.7.
 */
export async function evaluateClinicalInvariant(
  ctx: ClinicalInvariantContext,
  options?: EvaluateClinicalInvariantOptions,
): Promise<ClinicalInvariantVerdict> {
  // 1. Resolve mode exactly once. The wired call site already resolves
  //    mode once per request and would short-circuit on `off` before
  //    invoking this function (plan §15 PR 5.3 / 5.4); the resolver
  //    call here serves the unit-test path and provides a defensive
  //    second resolution if the wiring layer is bypassed (e.g. a
  //    future direct-call path that did not exist when PR 5.2 shipped).
  const mode: ClinicalInvariantEnforcementMode = options?.modeResolver
    ? await options.modeResolver()
    : await resolveClinicalInvariantEnforcementMode(ctx.clinicId);

  // 2. Off-mode short-circuit (CI-27). The wired call site is the
  //    primary off-mode short-circuit; this branch is a defensive
  //    secondary so the evaluator can be unit-tested in isolation.
  if (mode === "off") {
    return { action: "allow", disposition: "OFF" };
  }

  // 3. Emergency carve-out (CI-7). Short-circuits BEFORE the
  //    evaluator's DB read so emergency requests never trigger a
  //    SELECT. The emergency-bypass audit emitter lands in PR 5.7;
  //    this branch is the documented placeholder until then.
  if (ctx.isEmergency && typeof ctx.bypassReason === "string" && ctx.bypassReason.length > 0) {
    // TODO(Phase 5 PR 5.7): emit `clinical_invariant_emergency_bypass`
    // audit + increment `clinical_invariant_emergency_bypass_total`.
    return { action: "allow", disposition: "EMERGENCY_BYPASS" };
  }

  // 4. Delegate to the pure validation utility. This is the ONLY DB
  //    read the evaluator performs (CI-3, CI-24 — read-only). The
  //    SELECT happens inside the caller-provided tx so the result is
  //    a consistent view of state at the moment the wiring layer
  //    invoked us (CI-23 — evaluator runs strictly before any
  //    inventory / billing / outbox / event side effect in the tx).
  const { orphanLines } = await evaluateDispenseAgainstOrders(ctx.tx, {
    clinicId: ctx.clinicId,
    animalId: ctx.animalId,
    containerId: ctx.containerId,
    lines: ctx.lines,
  });

  // 5. Clean — no orphans detected.
  if (orphanLines.length === 0) {
    return { action: "allow" };
  }

  // 6. Orphans detected. Mode-specific verdict + counters.
  if (mode === "shadow") {
    clinicalInvariantMetrics.wouldHaveBlocked();
    const seenReasons = new Set<OrphanReasonCode>();
    for (const line of orphanLines) {
      for (const reason of line.reasons) {
        seenReasons.add(reason);
      }
    }
    for (const reason of seenReasons) {
      clinicalInvariantMetrics.wouldHaveBlockedReason(reason);
    }
    // TODO(Phase 5 PR 5.5): emit sampled
    // `clinical_invariant_shadow_would_have_blocked` audit row.
    // The audit kind + emitter file land in PR 5.5; PR 5.2
    // intentionally ships no audit emission.
    return { action: "allow", disposition: "WOULD_HAVE_BLOCKED_SHADOW" };
  }

  // mode === "enforce" — return deny verdict.
  //
  // PR 5.2 ships the verdict shape. The wired call site is the
  // consumer that rolls back the mutation tx and returns 422 (lands
  // in PR 5.7 via the JSON error helper from PR 5.6). PR 5.2 does
  // NOT increment any enforce-only counter and does NOT attempt the
  // denial audit — both land in PR 5.7 alongside their counter and
  // audit-kind literals.
  //
  // TODO(Phase 5 PR 5.7):
  //   - increment `clinical_invariant_blocked_total`;
  //   - increment per-reason `clinical_invariant_orphan_reason_*`;
  //   - attempt `clinical_invariant_orphan_dispense_denied` audit in
  //     the same tx (best-effort, not durable — CI-26).
  return {
    action: "deny",
    reason: "ORPHAN_DISPENSE_BLOCKED",
    orphanLines,
  };
}
