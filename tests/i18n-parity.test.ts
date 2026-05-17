import { describe, it, expect } from "vitest";
import { compareParity, loadLocaleFile } from "../scripts/i18n/check-parity";

describe("Locale key parity (en.json ↔ he.json)", () => {
  const en = loadLocaleFile("en");
  const he = loadLocaleFile("he");

  it("has zero keys present in en.json but missing from he.json", () => {
    const { inEnNotHe } = compareParity(en, he);
    expect(inEnNotHe).toEqual([]);
  });

  it("has zero keys present in he.json but missing from en.json", () => {
    const { inHeNotEn } = compareParity(en, he);
    expect(inHeNotEn).toEqual([]);
  });

  it("detects an injected mismatch (red-path verification)", () => {
    const injected = { ...(en as Record<string, unknown>), __synthetic_only_en__: "x" };
    const { inEnNotHe } = compareParity(injected, he);
    expect(inEnNotHe).toContain("__synthetic_only_en__");
  });

  it("walks `_meta.*` keys when present (per Phase 6 §5 invariant 13)", () => {
    const enWithMeta = {
      ...(en as Record<string, unknown>),
      _meta: { sampleNote: "internal-only metadata" },
    };
    const heMissing = en;
    const { inEnNotHe } = compareParity(enWithMeta, heMissing);
    expect(inEnNotHe).toContain("_meta.sampleNote");
  });
});
