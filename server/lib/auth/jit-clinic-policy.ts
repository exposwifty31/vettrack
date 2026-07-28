/**
 * C-6 incident hardening (2026-07-28): a Clerk session org with NO matching
 * vt_clinics row must never mint a clinic as a sign-in side effect — that is
 * how junk clinics were born when Clerk forced org-creation on signup. The one
 * sanctioned mint path is the ADMIN_EMAILS bootstrap (deliberate new-clinic
 * onboarding by the owner). Existing users always proceed: their upsert keeps
 * the DB clinic (onConflictDoUpdate excludes clinicId), so no clinic row is
 * needed for them.
 */
export type JitClinicDecision =
  | "proceed" // clinic row exists — normal path
  | "proceed-mint" // unknown org, admin bootstrap — mint deliberately
  | "proceed-existing" // unknown org but the user already has a row — DB clinic wins
  | "block-clinicless"; // unknown org, unknown user — join-code screen takes over

export function decideJitClinicPolicy(input: {
  clinicExists: boolean;
  adminEmail: boolean;
  hasExistingUser: boolean;
}): JitClinicDecision {
  if (input.clinicExists) return "proceed";
  if (input.adminEmail) return "proceed-mint";
  if (input.hasExistingUser) return "proceed-existing";
  return "block-clinicless";
}
