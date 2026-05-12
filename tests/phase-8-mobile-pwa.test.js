/**
 * Phase 8 — Mobile / PWA static-analysis tests.
 *
 * These tests read source files directly (no build, no browser) and assert
 * that the Phase 8 hardening rules are in place and won't regress.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. Manifest correctness (RTL + Hebrew)
// ---------------------------------------------------------------------------
describe("manifest.json", () => {
  const manifest = JSON.parse(read("public/manifest.json"));

  it('lang is "he"', () => {
    expect(manifest.lang).toBe("he");
  });

  it('dir is "auto" (not "ltr")', () => {
    expect(manifest.dir).toBe("auto");
  });

  it("has start_url", () => {
    expect(typeof manifest.start_url).toBe("string");
    expect(manifest.start_url.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. index.html RTL
// ---------------------------------------------------------------------------
describe("index.html", () => {
  const html = read("index.html");

  it('html element has lang="he"', () => {
    expect(html).toMatch(/lang="he"/);
  });

  it('html element has dir="rtl"', () => {
    expect(html).toMatch(/dir="rtl"/);
  });
});

// ---------------------------------------------------------------------------
// 3. Sheet.tsx — bottom variant has dvh max-height
// ---------------------------------------------------------------------------
describe("sheet.tsx bottom variant", () => {
  const sheet = read("src/components/ui/sheet.tsx");

  it("bottom variant includes max-h-[90dvh]", () => {
    // Extract only the bottom variant string
    const bottomMatch = sheet.match(/bottom:\s*"([^"]+)"/);
    expect(bottomMatch).not.toBeNull();
    expect(bottomMatch[1]).toContain("max-h-[90dvh]");
  });

  it("bottom variant includes overflow-y-auto", () => {
    const bottomMatch = sheet.match(/bottom:\s*"([^"]+)"/);
    expect(bottomMatch[1]).toContain("overflow-y-auto");
  });
});

// ---------------------------------------------------------------------------
// 4. No raw `vh` max-heights in bottom-sheet components
//    (dvh must be used so iOS Safari dynamic chrome is accounted for)
// ---------------------------------------------------------------------------
describe("dvh usage in bottom sheets", () => {
  const sheetFiles = [
    "src/components/move-room-sheet.tsx",
    "src/pages/equipment-list.tsx",
    "src/components/ui/sheet.tsx",
    "src/features/containers/components/DispenseSheet.tsx",
  ];

  for (const rel of sheetFiles) {
    it(`${rel} — no max-h-[*vh] (only dvh allowed)`, () => {
      const src = read(rel);
      // Allow max-h-[90dvh] etc., but not max-h-[90vh]
      const badMatches = src.match(/max-h-\[\d+vh\]/g) ?? [];
      expect(badMatches, `Found raw vh in ${rel}: ${badMatches.join(", ")}`).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. inputmode on numeric inputs in critical components
// ---------------------------------------------------------------------------
describe("inputmode attributes", () => {
  it("MedicationCalculator has inputMode='decimal' on all number inputs", () => {
    const src = read("src/components/MedicationCalculator.tsx");
    // Count type="number" occurrences
    const typeNumberCount = (src.match(/type="number"/g) ?? []).length;
    // Count inputMode="decimal" occurrences
    const inputModeCount = (src.match(/inputMode="decimal"/g) ?? []).length;
    // Every number input should have inputMode
    expect(inputModeCount).toBe(typeNumberCount);
  });

  it("return-plug-dialog has inputMode='numeric' on minute input", () => {
    const src = read("src/components/return-plug-dialog.tsx");
    expect(src).toContain('inputMode="numeric"');
  });
});

// ---------------------------------------------------------------------------
// 6. layout.tsx navigation menu uses dvh
// ---------------------------------------------------------------------------
describe("layout.tsx navigation menu", () => {
  it("nav dropdown uses max-h-[*dvh] not max-h-[*vh]", () => {
    const src = read("src/components/layout.tsx");
    // The menu dropdown div uses a cn() with the max-height class.
    // "menuReveal_220ms" is unique to the main nav dropdown (quick-settings uses 160ms).
    const anchor = "menuReveal_220ms";
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx, "Could not find menuReveal anchor in layout.tsx").toBeGreaterThan(-1);
    // Look at the 400 chars before the anchor (the cn() call with class names)
    const menuSection = src.slice(anchorIdx - 400, anchorIdx + 200);
    expect(menuSection).toContain("dvh");
    expect(menuSection).not.toMatch(/max-h-\[\d+vh\]/);
  });
});

// ---------------------------------------------------------------------------
// 7. Dispense container-selection bug regression guards
// ---------------------------------------------------------------------------
describe("dispense container-selection fixes", () => {
  const inventorySrc = read("src/pages/inventory-page.tsx");
  const dispenseSheetSrc = read("src/features/containers/components/DispenseSheet.tsx");

  it("handleOpenDispense uses selectedId, not containers[0].id", () => {
    // The callback must reference selectedId, not the first element of the array
    expect(inventorySrc).not.toMatch(/setDispenseContainerId\s*\(\s*containers\s*\[\s*0\s*\]\s*\.id\s*\)/);
    expect(inventorySrc).toMatch(/setDispenseContainerId\s*\(\s*selectedId\s*\)/);
  });

  it("DispenseSheet does not pass empty string as itemId fallback", () => {
    // itemId ?? "" would send an empty string that fails z.string().min(1) validation
    expect(dispenseSheetSrc).not.toMatch(/itemId\s*\?\?\s*""/);
  });

  it("DispenseSheet toast uses localized errorMessage, not raw res.message", () => {
    // Raw res.message surfaces English "Validation failed"; errorMessage() is always localized
    expect(dispenseSheetSrc).not.toMatch(/res\.message\?\.trim\(\)\s*\|\|\s*t\.dispense\.errorMessage/);
  });
});
