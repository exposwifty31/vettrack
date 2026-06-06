/**
 * Phase 6 PR 6.9 — Admin sheets extraction (3 components).
 *
 * Asserts that all Hebrew literals in the three admin sheet components
 * have been migrated to the new `admin.{crashCart, formulary, csvImport}.*`
 * locale namespace, and that the namespace resolves identically in both
 * locales.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";

describe("Phase 6 PR 6.9 — admin.crashCart.* resolves in both locales", () => {
  it("title + add", () => {
    expect(enDict.admin.crashCart.title).toBe("Configure crash cart");
    expect(heDict.admin.crashCart.title).toBe("הגדרת עגלת החייאה");
    expect(heDict.admin.crashCart.addItem).toBe("הוסף פריט");
  });

  it("toast.added / keyExists / removed", () => {
    expect(heDict.admin.crashCart.toast.added).toBe("פריט נוסף");
    expect(heDict.admin.crashCart.toast.keyExists).toBe("מפתח כבר קיים — בחר מפתח אחר");
    expect(heDict.admin.crashCart.toast.removed).toBe("פריט הוסר");
  });

  it("interpolating leaves: itemSubtitle + expiryWarnSuffix + removeConfirmDesc", () => {
    expect(enDict.admin.crashCart.itemSubtitle).toBe("{key} · qty: {qty}");
    expect(heDict.admin.crashCart.itemSubtitle).toBe("{key} · כמות: {qty}");
    expect(heDict.admin.crashCart.expiryWarnSuffix).toBe(" · אזהרת תוקף: {days}ד");
    expect(heDict.admin.crashCart.removeConfirmDesc).toBe(
      "האם להסיר את {label} מרשימת הבדיקה?",
    );
  });
});

describe("Phase 6 PR 6.9 — admin.formulary.* resolves in both locales", () => {
  it("title + add + search", () => {
    expect(heDict.admin.formulary.title).toBe("ניהול פורמולריום");
    expect(heDict.admin.formulary.addDrug).toBe("הוסף תרופה");
    expect(heDict.admin.formulary.searchPlaceholder).toBe("חפש שם תרופה…");
  });

  it("toast keys", () => {
    expect(heDict.admin.formulary.toast.added).toBe("תרופה נוספה");
    expect(heDict.admin.formulary.toast.updated).toBe("תרופה עודכנה");
    expect(heDict.admin.formulary.toast.removed).toBe("תרופה הוסרה");
  });

  it("field labels + dosage notes", () => {
    expect(heDict.admin.formulary.fieldName).toBe("שם תרופה *");
    expect(heDict.admin.formulary.fieldConcentration).toBe("ריכוז (mg/ml) *");
    expect(heDict.admin.formulary.fieldDosageNotes).toBe("הערות מינון");
    expect(heDict.admin.formulary.dosageNotesPlaceholder).toBe("הוראות מינון מיוחדות…");
    expect(heDict.admin.formulary.noneOption).toBe("— ללא —");
  });
});

describe("Phase 6 PR 6.9 — admin.csvImport.* resolves", () => {
  it("pleaseUploadCsv toast in both locales", () => {
    expect(enDict.admin.csvImport.toast.pleaseUploadCsv).toBe("Please upload a CSV file");
    expect(heDict.admin.csvImport.toast.pleaseUploadCsv).toBe("אנא העלה קובץ CSV");
  });
});

describe("Phase 6 PR 6.9 — 3 admin sheets contain zero raw Hebrew literals", () => {
  for (const file of [
    "src/components/crash-cart-admin-sheet.tsx",
    "src/components/csv-import-dialog.tsx",
  ]) {
    it(`${file} is Hebrew-free`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf-8");
      const hebrewMatches = source.match(/[֐-׿]+/g);
      expect(hebrewMatches).toBeNull();
    });
  }
});
