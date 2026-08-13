/**
 * Phase 4 PR 4.1 — Code Blue manager authority allowlist constant.
 *
 * Lives in `shared/` so policy data sits next to the existing `shared/authority.ts`
 * surface. The constant is consumed by the server-side Code Blue manager
 * evaluator (`server/lib/authority/enforcement/code-blue-manager.evaluator.ts`)
 * and may also be referenced by the future UI rollout phase. No frontend code
 * reads it today.
 *
 * Policy source: Phase 4 master plan §19 DECISION-1 (LOCKED).
 *
 * Excluded by design:
 *   - "night_admission_only" — their role is intake throughput; pulling them
 *     into a ~20-minute resus blocks the door.
 *   - "unknown" — sentinel for unmapped imported shifts.
 *
 * Per-clinic overrides are read at runtime from `vt_server_config` key
 * `code_blue.manager_oproles.<clinicId>` (consumed by the wiring in PR 4.5);
 * this constant is the default when no override is set.
 */

import type { DoctorOperationalShiftRole } from "./doctor-operational-shift.js";
import type { DoctorTeamRole } from "./doctor-teams.js";

/**
 * Doctor shift gate (2026-08-13): the check-in flow can now store the doctor
 * team roles "icu" and "internal_medicine" on a vet's open check-in. A vet
 * running the ICU or internal-medicine team is a doctor on the floor — the
 * evaluator's hard deny for a non-null, non-allowlisted operationalRole must
 * not strip them of Code Blue manager authority, so both team roles are
 * allowlisted here ("admission" was already in the DECISION-1 set).
 */
export const CODE_BLUE_MANAGER_ALLOWED_OPERATIONAL_ROLES = [
  "senior_lead",
  "admission",
  "ward",
  "night_senior_no_admission",
  "icu",
  "internal_medicine",
] as const satisfies readonly (DoctorOperationalShiftRole | DoctorTeamRole)[];

export type CodeBlueEligibleOperationalRole =
  (typeof CODE_BLUE_MANAGER_ALLOWED_OPERATIONAL_ROLES)[number];

/**
 * Membership predicate. Accepts any string for ergonomics; returns true only
 * when the value is in the default allowlist. Per-clinic override resolution
 * is the caller's responsibility (PR 4.5 wiring).
 */
export function isCodeBlueEligibleOperationalRole(
  value: string | null | undefined,
): value is CodeBlueEligibleOperationalRole {
  if (typeof value !== "string") return false;
  return (CODE_BLUE_MANAGER_ALLOWED_OPERATIONAL_ROLES as readonly string[]).includes(
    value,
  );
}
