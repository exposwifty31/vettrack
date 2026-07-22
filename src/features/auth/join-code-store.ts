/**
 * Carries a clinic join code from the sign-up link (`/signup?clinic=CODE`)
 * across Clerk's OAuth-redirect dance to the post-auth JoinClinicScreen, where
 * it pre-fills (and auto-submits) the join form. sessionStorage mirrors
 * requested-role-store.ts — the code survives same-tab redirects but is not a
 * durable credential on the device.
 */
const KEY = "vt_clinic_join_code";

const CARRIED_CODE_SHAPE = /^[A-Za-z0-9]{8,32}$/;

export function readCarriedJoinCode(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(KEY);
  return value && CARRIED_CODE_SHAPE.test(value) ? value : null;
}

export function writeCarriedJoinCode(code: string | null): void {
  if (typeof sessionStorage === "undefined") return;
  if (code && CARRIED_CODE_SHAPE.test(code)) sessionStorage.setItem(KEY, code);
  else sessionStorage.removeItem(KEY);
}

/**
 * Capture the `?clinic=CODE` invite-link parameter into the carry store.
 * Called on mount by /signin and /signup. A malformed value is ignored (the
 * shape guard in `writeCarriedJoinCode` would clear the store, and a previously
 * carried valid code must survive a later junk-parameter visit).
 */
export function captureJoinCodeFromSearch(search: string): void {
  // Uppercase at capture so the carried value matches the server's canonical
  // code form (sanitizeJoinCode) and the join screen's uppercased input.
  const code = new URLSearchParams(search).get("clinic")?.trim().toUpperCase();
  if (code && CARRIED_CODE_SHAPE.test(code)) writeCarriedJoinCode(code);
}
