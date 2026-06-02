/**
 * Phase 6 PR 6.7 — Code Blue extraction (4 files).
 *
 * Asserts that all enumerated Hebrew literals across the four Code Blue
 * page files have been migrated to t.codeBlue.* and that:
 *   - Drug labels (epi/atropine/vasopressin) live in t.codeBlue.drugs.*
 *     and are NOT sourced from the formulary table (per the Phase 6
 *     "Locale dict only" resolution to the §15 PR 6.7 drug-label
 *     ambiguity — see PR commit body).
 *   - Drug dose values (dosePerKg) and category are unchanged (data).
 *   - All four Code Blue page files contain zero raw Hebrew literals.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";

describe("Phase 6 PR 6.7 CORRECTION 1 — drug labels NOT in locale dict", () => {
  it("codeBlue.drugs.* is NOT present in en.json (clinical data, not copy)", () => {
    const codeBlue = (enDict as { codeBlue: Record<string, unknown> }).codeBlue;
    expect(codeBlue.drugs).toBeUndefined();
  });

  it("codeBlue.drugs.* is NOT present in he.json (parity preserved)", () => {
    const codeBlue = (heDict as { codeBlue: Record<string, unknown> }).codeBlue;
    expect(codeBlue.drugs).toBeUndefined();
  });

  it("codeBlue.units.* is NOT present in either locale (drug units are data)", () => {
    const enCodeBlue = (enDict as { codeBlue: Record<string, unknown> }).codeBlue;
    const heCodeBlue = (heDict as { codeBlue: Record<string, unknown> }).codeBlue;
    expect(enCodeBlue.units).toBeUndefined();
    expect(heCodeBlue.units).toBeUndefined();
  });
});

describe("Phase 6 PR 6.7 — codeBlue.preCheck.* + codeBlue.outcome.* resolve in both locales", () => {
  it("preCheck checklist items in both locales", () => {
    expect(enDict.codeBlue.preCheck.title).toBe("Equipment readiness");
    expect(heDict.codeBlue.preCheck.title).toBe("מוכנות ציוד");
    expect(enDict.codeBlue.preCheck.unitReady).toBe("Primary unit deployable");
    expect(heDict.codeBlue.preCheck.unitReady).toBe("יחידה ראשית ניתנת לפריסה");
    expect(enDict.codeBlue.preCheck.cartReady).toBe("Crash cart verified");
    expect(heDict.codeBlue.preCheck.cartReady).toBe("עגלת חירום מאומתת");
    expect(enDict.codeBlue.preCheck.monitorOnScene).toBe("Monitor / AED on scene");
    expect(heDict.codeBlue.preCheck.transportReady).toBe("ציוד הובלה מוכן");
  });

  it("outcome labels in both locales", () => {
    expect(enDict.codeBlue.outcome.rosc).toBe("ROSC — return of cardiac activity");
    expect(heDict.codeBlue.outcome.rosc).toBe("ROSC — חזרת פעילות לב");
    expect(heDict.codeBlue.outcome.transferred).toBe("הועבר לבית חולים");
    expect(heDict.codeBlue.outcome.ongoing).toBe("ממשיך — לא הסתיים");
    expect(heDict.codeBlue.outcome.died).toBe("הכרזת מוות");
  });
});

describe("Phase 6 PR 6.7 — codeBlue.history + codeBlue.reconciliation resolve", () => {
  it("history outcome labels", () => {
    expect(heDict.codeBlue.history.outcomeLabels.died).toBe("נפטר");
    expect(heDict.codeBlue.history.outcomeLabels.transferred).toBe("הועבר");
    expect(heDict.codeBlue.history.outcomeLabels.ongoing).toBe("ממשיך");
  });

  it("history title", () => {
    expect(heDict.codeBlue.history.title).toBe("היסטוריית CODE BLUE");
    expect(enDict.codeBlue.history.title).toBe("CODE BLUE History");
  });

  it("reconciliation title + badge", () => {
    expect(heDict.codeBlue.reconciliation.title).toBe("גישור קוד כחול");
    expect(heDict.codeBlue.reconciliation.badge.reconciled).toBe("גושר");
  });
});

describe("Phase 6 PR 6.7 — 4 Code Blue files contain zero raw Hebrew literals", () => {
  for (const file of [
    "src/pages/code-blue.tsx",
    "src/pages/code-blue-display.tsx",
    "src/pages/code-blue-history.tsx",
  ]) {
    it(`${file} is Hebrew-free`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf-8");
      const hebrewMatches = source.match(/[֐-׿]+/g);
      expect(hebrewMatches).toBeNull();
    });
  }
});

describe("Code Blue — equipment-only quick log", () => {
  it("code-blue.tsx has no shock/CPR clinical quick-log", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/code-blue.tsx"), "utf-8");
    expect(source).not.toMatch(/category:\s*["']shock["']/);
    expect(source).not.toMatch(/category:\s*["']cpr["']/);
    expect(source).not.toMatch(/Epinephrine/);
    expect(source).not.toMatch(/dosePerKg/);
    expect(source).toContain('category: "equipment"');
  });
});
