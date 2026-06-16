/**
 * Phase 6 PR 6.6 — QR scanner toasts + NFC layout error path migration.
 *
 * Asserts that the six enumerated literals migrated by PR 6.6:
 *   src/components/qr-scanner.tsx
 *     line 463: "${name} checked out" → t.scanner.toast.checkedOut(name)
 *     line 489: "${name} returned"    → t.scanner.toast.returned(name)
 *   src/components/layout.tsx (NFC paths)
 *     line 288: "תווית NFC לא חוקית עבור מכל"          → t.nfc.error.invalidContainerTag
 *     line 313: "תווית NFC לא חוקית עבור פריט מלאי"    → t.nfc.error.invalidInventoryItemTag
 *     line 318: "פתח סשן מילוי מחדש לפני סריקת תוויות פריטים" → t.nfc.error.restockSessionRequired
 *     line 345: "סריקת מלאי נכשלה"                       → t.nfc.error.scanFailed
 * resolve to the expected English and Hebrew strings.
 *
 * Per §15 PR 6.6 Tests, full coverage is "Playwright: open scanner,
 * switch locale, no camera re-init regression; NFC error path renders
 * in both locales." Playwright requires a running app; this vitest
 * locale-resolution + structural-lockfile coverage stands in for it
 * within the headless test runner. The Playwright spec is a separate
 * deliverable to run before merge (documented in the PR description).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { interpolate } from "../lib/i18n/index";

describe("Phase 6 PR 6.6 — scanner.toast.* resolves in both locales", () => {
  it("checkedOut interpolates {name} into English", () => {
    expect(
      interpolate(enDict.scanner.toast.checkedOut, { name: "Defib-A" }),
    ).toBe("Defib-A checked out");
  });

  it("checkedOut interpolates {name} into Hebrew", () => {
    expect(
      interpolate(heDict.scanner.toast.checkedOut, { name: "Defib-A" }),
    ).toBe("Defib-A נלקח");
  });

  it("returned interpolates {name} into English", () => {
    expect(
      interpolate(enDict.scanner.toast.returned, { name: "Defib-A" }),
    ).toBe("Defib-A returned");
  });

  it("returned interpolates {name} into Hebrew", () => {
    expect(
      interpolate(heDict.scanner.toast.returned, { name: "Defib-A" }),
    ).toBe("Defib-A הוחזר");
  });
});

describe("Phase 6 PR 6.6 — nfc.error.* resolves in both locales", () => {
  it("invalidContainerTag English", () => {
    expect(enDict.nfc.error.invalidContainerTag).toBe("Invalid NFC tag for container");
  });
  it("invalidContainerTag Hebrew", () => {
    expect(heDict.nfc.error.invalidContainerTag).toBe("תווית NFC לא חוקית עבור מכל");
  });

  it("invalidInventoryItemTag English", () => {
    expect(enDict.nfc.error.invalidInventoryItemTag).toBe("Invalid NFC tag for inventory item");
  });
  it("invalidInventoryItemTag Hebrew", () => {
    expect(heDict.nfc.error.invalidInventoryItemTag).toBe("תווית NFC לא חוקית עבור פריט מלאי");
  });

  it("restockSessionRequired English", () => {
    expect(enDict.nfc.error.restockSessionRequired).toBe(
      "Open a restock session before scanning item tags",
    );
  });
  it("restockSessionRequired Hebrew", () => {
    expect(heDict.nfc.error.restockSessionRequired).toBe(
      "פתח סשן מילוי מחדש לפני סריקת תוויות פריטים",
    );
  });

  it("scanFailed English", () => {
    expect(enDict.nfc.error.scanFailed).toBe("Inventory scan failed");
  });
  it("scanFailed Hebrew", () => {
    expect(heDict.nfc.error.scanFailed).toBe("סריקת מלאי נכשלה");
  });
});

describe("Phase 6 PR 6.6 — source files no longer contain the migrated literals", () => {
  const qrScannerSource = readFileSync(
    resolve(process.cwd(), "src/components/qr-scanner.tsx"),
    "utf-8",
  );
  const layoutSource = readFileSync(
    resolve(process.cwd(), "src/components/layout.tsx"),
    "utf-8",
  );

  it("qr-scanner.tsx does not contain the literal '${...} checked out' template", () => {
    expect(qrScannerSource).not.toMatch(/`\$\{[^}]+\}\s+checked out`/);
  });

  it("qr-scanner.tsx does not contain the literal '${...} returned' template", () => {
    expect(qrScannerSource).not.toMatch(/`\$\{[^}]+\}\s+returned`/);
  });

  it("layout.tsx NFC paths do not contain the four migrated Hebrew literals", () => {
    expect(layoutSource).not.toContain("תווית NFC לא חוקית עבור מכל");
    expect(layoutSource).not.toContain("תווית NFC לא חוקית עבור פריט מלאי");
    expect(layoutSource).not.toContain("פתח סשן מילוי מחדש לפני סריקת תוויות פריטים");
    expect(layoutSource).not.toContain("סריקת מלאי נכשלה");
  });

  it("layout.tsx no longer contains the two previously-deferred restock toast literals", () => {
    // §15 PR 6.6 migrated four NFC literals and deferred these two restock
    // toasts to a later PR. That migration is now complete: both render via
    // i18n (lh.restockSwitchContainerWarning / t.nfc.error.noActiveRestockSession),
    // so the literals must no longer appear in source.
    expect(layoutSource).not.toContain("סיים את המילוי מחדש");
    expect(layoutSource).not.toContain("לא נמצא סשן מילוי מחדש פעיל");
  });
});
