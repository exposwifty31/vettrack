import type { SignupRequestedRole } from "./components/RoleChips";

/**
 * Carries a role the user pre-chose on the sign-in screen over to the sign-up
 * screen (C5), so "land → pick role → create account" pre-selects the chip.
 * sessionStorage (not a URL param) keeps the role out of shareable links.
 */
const KEY = "vt_signup_requested_role";

export function readCarriedRole(): SignupRequestedRole | null {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(KEY);
  return value === "vet" || value === "technician" ? value : null;
}

export function writeCarriedRole(role: SignupRequestedRole | null): void {
  if (typeof sessionStorage === "undefined") return;
  if (role) sessionStorage.setItem(KEY, role);
  else sessionStorage.removeItem(KEY);
}
