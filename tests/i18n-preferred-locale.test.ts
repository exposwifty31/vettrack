// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  applyPreferredLocale,
  getStoredLocale,
  setStoredLocale,
  LOCALE_STORAGE_KEY,
} from "@/lib/i18n";

/**
 * IPHONE-4 — the reviewer account's server-side preferred_locale (en) must be
 * honored as a resolution fallback so a fresh install doesn't boot Hebrew for
 * the English reviewer, WITHOUT breaking the explicit-choice precedence.
 *
 * Single deterministic test: module-level `sessionPreferredLocale` persists
 * across `it` blocks, so the ordering here (anonymous → applied → explicit)
 * is asserted as one sequence to keep it isolation-proof.
 */
describe("applyPreferredLocale (reviewer preferred_locale load-order)", () => {
  it("resolves preferred_locale only as a fallback, never over an explicit choice", () => {
    window.localStorage.clear();

    // Anonymous / no preferred applied → Hebrew default.
    expect(getStoredLocale()).toBe("he");

    // Signed-in user with preferred_locale=en and no explicit in-app choice → en.
    applyPreferredLocale("en");
    expect(getStoredLocale()).toBe("en");

    // An explicit in-app language choice always wins over the profile preference.
    setStoredLocale("he");
    applyPreferredLocale("en");
    expect(getStoredLocale()).toBe("he");

    // Unsupported/empty preferred values are ignored (explicit choice stands).
    applyPreferredLocale("fr");
    applyPreferredLocale(null);
    expect(getStoredLocale()).toBe("he");

    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  });
});
