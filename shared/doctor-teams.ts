/**
 * Doctor shift gate (spec 2026-08-13) — the three doctor team roles.
 *
 * Lives in `shared/` so both the clinical check-in service (check-in-time
 * validation) and the authority enforcement layer (use-time revalidation in
 * `server/lib/authority/enforcement/oprole.evaluator.ts` + the PR 5.3 shadow
 * validator) consume ONE definition. Team roles are universally allowed for
 * vets — no `allowedOperationalRoles` membership required — so check-in-time
 * and use-time semantics stay identical by construction.
 */
export const DOCTOR_TEAM_ROLES = ["icu", "admission", "internal_medicine"] as const;
export type DoctorTeamRole = (typeof DOCTOR_TEAM_ROLES)[number];

const DOCTOR_TEAM_ROLE_SET = new Set<string>(DOCTOR_TEAM_ROLES);

export function isDoctorTeamRole(v: string): v is DoctorTeamRole {
  return DOCTOR_TEAM_ROLE_SET.has(v);
}
