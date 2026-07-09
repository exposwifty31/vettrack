// Phase 9 — paired display-device token storage (client).
//
// A paired Department Display is a durable, headless device: it authenticates
// with a `vtd_`-prefixed device token (minted once by POST /api/display/pair/claim)
// instead of a Clerk user session. The token is persisted in localStorage so the
// pairing survives reloads and power-cycles, and is attached as the
// `x-display-token` header on the board's data requests (see auth-fetch.ts +
// realtime.ts).
//
// This is deliberately a DEVICE credential, not a user session: it never flows
// through the Clerk/bearer path and only ever reaches the display-token
// endpoints (snapshot / heartbeat / realtime stream) that opt in via the
// server's `requireDisplayOrUser` middleware.

import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from "@/lib/safe-browser";

export const DISPLAY_TOKEN_STORAGE_KEY = "vt_display_token";
export const DISPLAY_CLINIC_STORAGE_KEY = "vt_display_clinic_id";

/** Matches the server's `vtd_` device-token shape (see server/lib/display-token). */
const DISPLAY_TOKEN_PREFIX = "vtd_";

function looksLikeDisplayToken(value: string): boolean {
  return value.startsWith(DISPLAY_TOKEN_PREFIX) && value.length > DISPLAY_TOKEN_PREFIX.length;
}

/** The stored display-device token, or null when this browser is not a paired display. */
export function getStoredDisplayToken(): string | null {
  const raw = safeStorageGetItem(DISPLAY_TOKEN_STORAGE_KEY, "local");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed && looksLikeDisplayToken(trimmed) ? trimmed : null;
}

/** True when a display-device token is stored (this browser acts as a paired display). */
export function hasStoredDisplayToken(): boolean {
  return getStoredDisplayToken() !== null;
}

/** Persist the device token (+ its clinic) after a successful pairing claim. */
export function setStoredDisplayToken(token: string, clinicId?: string): void {
  safeStorageSetItem(DISPLAY_TOKEN_STORAGE_KEY, token, "local");
  if (clinicId) safeStorageSetItem(DISPLAY_CLINIC_STORAGE_KEY, clinicId, "local");
}

/** The clinic id captured at pairing time (advisory; the server derives clinic from the token). */
export function getStoredDisplayClinicId(): string | null {
  const raw = safeStorageGetItem(DISPLAY_CLINIC_STORAGE_KEY, "local");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}

/** Forget the pairing (e.g. after revoke detection or an explicit reset). */
export function clearStoredDisplayToken(): void {
  safeStorageRemoveItem(DISPLAY_TOKEN_STORAGE_KEY, "local");
  safeStorageRemoveItem(DISPLAY_CLINIC_STORAGE_KEY, "local");
}
