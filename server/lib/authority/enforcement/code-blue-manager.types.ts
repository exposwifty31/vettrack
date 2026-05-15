/**
 * Phase 4 PR 4.1 — Code Blue manager evaluator types.
 *
 * Sibling-only file. Lives outside `result.ts` to keep the PR 7 / PR 3.3 /
 * PR 3.6 frozen result types untouched (additive-only PR discipline).
 *
 * The Code Blue manager evaluator is conceptually distinct from the existing
 * oprole / stale / task-assignment / stale-task-ownership evaluators:
 *
 *   - oprole.evaluator asks: "is the user still allowed to hold the
 *     operational role they checked in as?"
 *   - code-blue-manager evaluator asks: "is the target manager's checked-in
 *     operational role in the Code-Blue-eligible set?"
 *
 * Two different predicates over different inputs. The frameworks shared:
 *   - resolveAuthority() — the caller resolves the target's snapshot through
 *     the existing resolver (NOT this evaluator). Caller hydrates a discriminated
 *     `CodeBlueManagerLookup` and passes it in.
 *   - vt_server_config / env-flag resolution chain — `config.ts`.
 *   - logAudit / metrics — through this family's own audit/metrics helpers.
 *
 * Foundation-only contract (§15 PR 4.1): no route invokes this evaluator yet.
 * Wiring lands in PR 4.2 (initiation), PR 4.3 (end), PR 4.4a (mid-session).
 */

import type { AuthoritySnapshot } from "../../../../shared/authority.js";

/**
 * Enforcement mode union. Same vocabulary as the existing families. The
 * resolver in `config.ts` validates `off | shadow | enforce` and collapses
 * anything else to `off` (typo-defensive).
 */
export type CodeBlueManagerEnforcementMode = "off" | "shadow" | "enforce";

/**
 * Per-endpoint sub-key. Each Code Blue endpoint resolves its mode
 * independently so a clinic can shadow `initiation` while running `end` at
 * `off` (or any other combination).
 */
export type CodeBlueManagerEndpoint = "initiation" | "end";

/**
 * Stable deny-reason union. Each reason maps 1:1 to a flat counter pair
 * (shadow_denied_* / denied_*) and to the rate-limit bucket in the audit
 * emitter. Reasons are stable contract — UI/runbooks may key off them.
 */
export type CodeBlueManagerDenyReason =
  | "OPROLE_NOT_IN_CB_ALLOWLIST"
  | "NO_OPEN_CHECK_IN"
  | "MANAGER_CROSS_CLINIC"
  | "USER_MISSING";

/**
 * Caller-hydrated lookup of the target manager's authority. The evaluator
 * never reads the database, never calls `resolveAuthority`, never throws.
 *
 * Wiring helpers (PR 4.2+):
 *   - load `vt_users` by id, scoped to the request's `clinicId`
 *   - if missing → `{ kind: "user_missing" }`
 *   - if row's clinicId mismatches → `{ kind: "cross_clinic" }`
 *   - otherwise, construct a target-user object from DB fields and invoke
 *     `resolveAuthority({ authUser: target, clinicId, now })`
 *   - if resolveAuthority throws → `{ kind: "resolver_fault" }` (fail-open)
 *   - if it returns a snapshot → `{ kind: "snapshot", snapshot }`
 *
 * The evaluator MUST NOT receive `req.authoritySnapshot` for the manager —
 * that snapshot belongs to the request actor, not the manager.
 */
export type CodeBlueManagerLookup =
  | { kind: "snapshot"; snapshot: AuthoritySnapshot }
  | { kind: "user_missing" }
  | { kind: "cross_clinic" }
  | { kind: "resolver_fault" };

/**
 * Pure-data context. No Express request, no DB handle. Same discipline as
 * the existing evaluators.
 */
export interface CodeBlueManagerContext {
  clinicId: string;
  now: Date;
  endpoint: CodeBlueManagerEndpoint;
  /** UID of the persisted/nominated manager (for audit fields). */
  managerUserId: string;
  /** Caller-hydrated lookup result. */
  lookup: CodeBlueManagerLookup;
}

/**
 * Verdict shape. Mirrors `StaleTaskOwnershipAllow.protected` discriminator
 * pattern so the caller can observe WHY a shadow-mode would-deny was demoted
 * to allow without inspecting the mode. The `decision` taxonomy mentioned in
 * the master plan (`allow | deny | mode_inactive | fault_open`) is encoded
 * here as `action: "allow" | "deny"` + `protected` discriminator — same
 * information, consistent with the framework's existing evaluator shape.
 */
export type CodeBlueManagerAllowReason =
  | "MODE_OFF"
  | "MODE_INACTIVE_STRATEGY_A"
  | "FAULT_OPEN"
  | "ALLOWLIST_OK"
  | "SHADOW_WOULD_HAVE_DENIED";

export interface CodeBlueManagerAllow {
  action: "allow";
  protected?: CodeBlueManagerAllowReason;
}

export interface CodeBlueManagerDeny {
  action: "deny";
  reason: CodeBlueManagerDenyReason;
}

export type CodeBlueManagerVerdict = CodeBlueManagerAllow | CodeBlueManagerDeny;
