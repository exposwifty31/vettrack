/**
 * Phase 2A: Shared authority types.
 *
 * Additive scaffolding only — no runtime enforcement in Phase 2A.
 * The legacy authorization stack (requireEffectiveRole, requireRole,
 * requireAdmin, ROLE_HIERARCHY, resolveCurrentRole) remains fully authoritative
 * until Phase 2B enforcement migration.
 *
 * Keep this file free of server-only imports so it can be used by both
 * frontend and backend without bundler conflicts.
 */

import type { DoctorOperationalShiftRole } from "./doctor-operational-shift.js";

/** System-level role: whether a principal is a system administrator or a regular user. */
export type SystemRole = "Admin" | "User";

/**
 * Clinical authority roles. Covers the full range of clinical identity a user
 * may carry, including "student". Enforcement of clinical ceilings is Phase 2B.
 */
export type ClinicalRole =
  | "vet"
  | "senior_technician"
  | "technician"
  | "student";

/**
 * Roles that may appear as an active shift-assignable clinical authority.
 * Intentionally excludes "admin" (system role, no clinical shift) and
 * "student" (students are never elevated to shift authority).
 */
export type ActiveShiftRole =
  | "vet"
  | "senior_technician"
  | "technician";

/**
 * Resolved effective clinical role after authority evaluation.
 * Aliased to ActiveShiftRole so "student" can never appear here — the student
 * never-elevated rule is enforced at the type level in Phase 2A.
 */
export type EffectiveClinicalRole = ActiveShiftRole;

/**
 * Operational role dimension.
 * Phase 2.5 widens this from `null`-only to the doctor operational shift role
 * domain (excluding the sentinel "unknown"), or null when no operational role
 * is in effect. This is a pure type-level widening; resolver behavior and the
 * set of values actually emitted at runtime are unchanged in PR 1.
 */
export type OperationalRole = Exclude<DoctorOperationalShiftRole, "unknown"> | null;

/**
 * How a user's authority was obtained.
 * "check_in" is reserved for Phase 2.5 clinical check-in resolution and is
 * not emitted by the resolver in PR 1.
 */
export type AuthoritySource = "shift" | "no_active_shift" | "check_in";

/**
 * Categorical reason explaining how authority resolution arrived at its result.
 * "CHECKED_IN", "CACHED", "NOT_CHECKED_IN", and "CHECKED_IN_NO_OPROLE" are
 * reserved for Phase 2.5 check-in resolution and cache plumbing; they are not
 * emitted by the resolver in PR 1.
 *
 * Phase 2.5 PR 7 enforcement denials (gated by env flags
 * AUTHORITY_STALE_ENFORCE_V1 / AUTHORITY_OPROLE_ENFORCE_V1):
 *   - "CHECKED_IN_STALE" — open check-in row exceeds the configured ceiling.
 *   - "CHECKED_IN_OPROLE_REVOKED" — checkIn.operationalRole no longer in the
 *     user's current allowedOperationalRoles allowlist.
 */
export type AuthorityReason =
  | "EZSHIFT_ACTIVE"
  | "EZSHIFT_NONE"
  | "SHIFT_ROLE_NOT_CLINICAL"
  | "STUDENT_NEVER_ELEVATED"
  | "LEGACY_ADMIN_NO_CLINICAL"
  | "MISSING_USER_NAME"
  | "RESOLUTION_ERROR"
  | "CHECKED_IN"
  | "CACHED"
  | "NOT_CHECKED_IN"
  | "CHECKED_IN_NO_OPROLE"
  | "CHECKED_IN_STALE"
  | "CHECKED_IN_OPROLE_REVOKED";

/** Point-in-time snapshot of a user's resolved authority state. */
export interface AuthoritySnapshot {
  systemRole: SystemRole;
  clinicalRole: ClinicalRole | null;
  activeShiftRole: ActiveShiftRole | null;
  operationalRole: OperationalRole;
  effectiveClinicalRole: EffectiveClinicalRole | null;
  source: AuthoritySource;
  reason: AuthorityReason;
  resolvedAt: string;
}
