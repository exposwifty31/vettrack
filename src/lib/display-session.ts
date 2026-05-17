// Phase 9 PR 9.2 — Department Display session id.
//
// displaySessionId is a short-lived random value minted client-side at page
// load and scoped to the tab's sessionStorage lifetime (lost on tab close).
//
// Safety contract (plan §3.2):
//   - Used ONLY as an internal short-lived rate-limit / coalescing key.
//   - NEVER used as a metric label, audit field, clinical identifier,
//     authority input, billing input, enforcement input, or persistent device
//     identity.
//   - NEVER written to the database. NEVER logged in audit rows. NEVER
//     exposed in any Prometheus label.

import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";

const STORAGE_KEY = "vt_display_session_id";

function generateSessionId(): string {
  // 96 random bits, base36 encoded, prefixed with a short namespace marker so
  // a casual reader can tell what the value is. Cryptographic strength is not
  // required — this is a coalescing key, not a security primitive.
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const buf = new Uint8Array(12);
      crypto.getRandomValues(buf);
      const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
      return `ds_${hex}`;
    }
  } catch {
    // fall through to Math.random fallback
  }
  return `ds_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function getOrCreateDisplaySessionId(): string {
  const existing = safeStorageGetItem(STORAGE_KEY, "session");
  if (existing && /^[a-zA-Z0-9_-]{4,64}$/.test(existing)) return existing;
  const fresh = generateSessionId();
  safeStorageSetItem(STORAGE_KEY, fresh, "session");
  return fresh;
}
