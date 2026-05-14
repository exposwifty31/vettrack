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
