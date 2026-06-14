// src/lib/equipment-id.ts (NEW) — pure, zero heavy imports

// D5 — single canonical PRODUCTION origin for NFC tags + Universal Links.
// Asserted single source of truth: vettrack.uk is the sole production web origin
// (already used for the SEO canonical/og:url in src/pages/landing.tsx:122,126 and as the
// VITE_API_ORIGIN example in src/vite-env.d.ts:19). NFC tags are PHYSICAL artifacts for the
// production fleet, so even a dev/staging build must encode the prod UL domain — there is no
// per-environment tag origin. Both the tag writer (equipment-detail.tsx) and the router
// hostname check import THIS constant so they can never diverge.
export const UNIVERSAL_LINK_ORIGIN = "https://vettrack.uk";
export const UNIVERSAL_LINK_HOST = "vettrack.uk";

export function extractEquipmentId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/");
    const idx = parts.indexOf("equipment");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    if (!trimmed.includes(" ") && trimmed.length > 0) return trimmed;
    return null;
  }
}
