/**
 * @vitest-environment happy-dom
 *
 * R-CBF-1.4 — inline drug-dose reference in the timed log.
 *
 * A static, versioned, clinician-approved drug-dose reference rendered inline
 * in the Code Blue timed-log view. This is reference DATA (bundled, no network,
 * no new domain) — but it is CLINICAL-CRITICAL, so provenance is MANDATORY and
 * ENFORCED, never optional:
 *
 *   - each entry carries a NAMED clinician-approved source, a version + a
 *     well-formed effective date, an explicit species / weight-band /
 *     concentration / unit scope, and a NAMED review/update owner;
 *   - presence alone is INSUFFICIENT — an EMPTY/placeholder source or owner, a
 *     malformed version or effective-date, or an out-of-scope/unsupported
 *     species / weight / concentration / unit each FAIL validation (unsafe dose
 *     guidance must never satisfy a mere non-null check);
 *   - the bundled table is itself versioned and shows its provenance;
 *   - renders in he + en; no PII; no network dependency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { refreshTranslations, t } from "@/lib/i18n";
import {
  DRUG_DOSE_REFERENCE,
  validateDrugDoseEntry,
  type DrugDoseEntry,
} from "@/features/code-blue/drug-reference";
import { DrugDoseReference } from "@/features/code-blue/DrugDoseReference";

// A fully-valid entry the negative cases mutate one field at a time.
const VALID_ENTRY: DrugDoseEntry = {
  id: "epi-canine",
  drug: "Epinephrine",
  indication: "Cardiac arrest (CPA)",
  dose: "0.01 mg/kg IV/IO",
  route: "IV/IO",
  species: "canine",
  weightBandKg: { minKg: 2, maxKg: 60 },
  concentration: "1 mg/mL (1:1000)",
  unit: "mg/kg",
  source: "AVMA/RECOVER CPR Guidelines",
  version: "1.0.0",
  effectiveDate: "2026-01-15",
  reviewOwner: "Emergency & Critical Care Lead",
};

afterEach(() => {
  cleanup();
  refreshTranslations(); // restore stored/default locale
});

describe("R-CBF-1.4 · provenance validation (clinical safety — presence is insufficient)", () => {
  it("accepts a fully-provenanced, in-scope entry", () => {
    const result = validateDrugDoseEntry(VALID_ENTRY);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("every bundled reference entry passes validation", () => {
    expect(DRUG_DOSE_REFERENCE.entries.length).toBeGreaterThan(0);
    for (const entry of DRUG_DOSE_REFERENCE.entries) {
      const result = validateDrugDoseEntry(entry);
      expect(result.valid, `${entry.id}: ${result.errors.join(", ")}`).toBe(true);
    }
  });

  it("the bundled table is itself versioned + provenanced", () => {
    expect(DRUG_DOSE_REFERENCE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(DRUG_DOSE_REFERENCE.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DRUG_DOSE_REFERENCE.source.trim().length).toBeGreaterThan(0);
    expect(DRUG_DOSE_REFERENCE.reviewOwner.trim().length).toBeGreaterThan(0);
  });

  // --- missing provenance field → FAIL ---------------------------------------
  it.each(["source", "version", "effectiveDate", "reviewOwner"] as const)(
    "rejects an entry MISSING the %s provenance field",
    (field) => {
      const { [field]: _omit, ...rest } = VALID_ENTRY;
      const result = validateDrugDoseEntry(rest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(field))).toBe(true);
    },
  );

  // --- empty / placeholder source or owner → FAIL ----------------------------
  it.each(["", "   ", "TBD", "N/A", "todo", "???", "---", "placeholder"])(
    "rejects an empty/placeholder source (%j)",
    (bad) => {
      expect(validateDrugDoseEntry({ ...VALID_ENTRY, source: bad }).valid).toBe(false);
    },
  );

  it.each(["", "   ", "TBD", "N/A", "todo", "???", "---", "placeholder"])(
    "rejects an empty/placeholder review owner (%j)",
    (bad) => {
      expect(validateDrugDoseEntry({ ...VALID_ENTRY, reviewOwner: bad }).valid).toBe(false);
    },
  );

  // --- malformed version → FAIL ----------------------------------------------
  it.each(["1.0", "v1.0.0", "1", "1.0.0-beta", "latest", "1.0.0.0", ""])(
    "rejects a malformed version (%j)",
    (bad) => {
      const result = validateDrugDoseEntry({ ...VALID_ENTRY, version: bad });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    },
  );

  // --- malformed effective date → FAIL ---------------------------------------
  it.each(["not-a-date", "2026-13-40", "2026/01/15", "15-01-2026", "2026-02-30", ""])(
    "rejects a malformed effective date (%j)",
    (bad) => {
      const result = validateDrugDoseEntry({ ...VALID_ENTRY, effectiveDate: bad });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("effectiveDate"))).toBe(true);
    },
  );

  // --- out-of-scope species → FAIL -------------------------------------------
  it.each(["equine", "human", "avian", "", "CANINE-ish", "reptile"])(
    "rejects an unsupported/out-of-scope species (%j)",
    (bad) => {
      const result = validateDrugDoseEntry({ ...VALID_ENTRY, species: bad as never });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("species"))).toBe(true);
    },
  );

  // --- out-of-scope weight band → FAIL ---------------------------------------
  it.each([
    { minKg: -1, maxKg: 60 },
    { minKg: 10, maxKg: 5 },
    { minKg: 0, maxKg: 0 },
    { minKg: 2, maxKg: 5000 },
    { minKg: Number.NaN, maxKg: 60 },
  ])("rejects an out-of-scope weight band (%j)", (band) => {
    const result = validateDrugDoseEntry({ ...VALID_ENTRY, weightBandKg: band });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("weight"))).toBe(true);
  });

  // --- out-of-scope concentration → FAIL -------------------------------------
  it.each(["", "   ", "TBD", "0 mg/mL", "no concentration", "???"])(
    "rejects an out-of-scope/unsupported concentration (%j)",
    (bad) => {
      const result = validateDrugDoseEntry({ ...VALID_ENTRY, concentration: bad });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("concentration"))).toBe(true);
    },
  );

  // --- unsupported unit → FAIL -----------------------------------------------
  it.each(["mg", "g/kg", "", "ml", "puffs", "1:1000"])(
    "rejects an unsupported dose unit (%j)",
    (bad) => {
      const result = validateDrugDoseEntry({ ...VALID_ENTRY, unit: bad as never });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("unit"))).toBe(true);
    },
  );

  it("null / non-object input fails safely (never throws, never passes)", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const result = validateDrugDoseEntry(bad as never);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("R-CBF-1.4 · inline render (provenance shown, no network, no PII)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("no network in drug reference")));
    // @ts-expect-error – test override
    globalThis.fetch = fetchSpy;
  });

  it("renders the table provenance: source + version + effective date + review owner", () => {
    refreshTranslations("en");
    render(<DrugDoseReference defaultOpen />);
    const region = screen.getByTestId("cb-drug-reference");
    const text = region.textContent ?? "";
    expect(text).toContain(DRUG_DOSE_REFERENCE.source);
    expect(text).toContain(DRUG_DOSE_REFERENCE.version);
    expect(text).toContain(DRUG_DOSE_REFERENCE.reviewOwner);
    // effective date rendered in some human form containing the year
    expect(text).toContain(DRUG_DOSE_REFERENCE.effectiveDate.slice(0, 4));
  });

  it("renders each in-scope entry with its species / weight / concentration / unit scope", () => {
    refreshTranslations("en");
    render(<DrugDoseReference defaultOpen />);
    const sample = DRUG_DOSE_REFERENCE.entries[0];
    const entry = screen.getByTestId(`cb-drug-entry-${sample.id}`);
    const text = entry.textContent ?? "";
    expect(text).toContain(sample.drug);
    expect(text).toContain(sample.dose);
    expect(text).toContain(sample.concentration);
    expect(text).toContain(sample.unit);
    expect(text).toContain(String(sample.weightBandKg.minKg));
    expect(text).toContain(String(sample.weightBandKg.maxKg));
    // per-entry provenance
    expect(text).toContain(sample.source);
    expect(text).toContain(sample.reviewOwner);
  });

  it("renders localized chrome in both he and en (title differs by locale)", () => {
    refreshTranslations("en");
    const { unmount } = render(<DrugDoseReference defaultOpen />);
    const enTitle = t.codeBlue.drugReference.title;
    expect(screen.getByTestId("cb-drug-reference").textContent).toContain(enTitle);
    unmount();

    refreshTranslations("he");
    render(<DrugDoseReference defaultOpen />);
    const heTitle = t.codeBlue.drugReference.title;
    expect(heTitle).not.toBe(enTitle); // parity: distinct copy per locale
    expect(screen.getByTestId("cb-drug-reference").textContent).toContain(heTitle);
  });

  it("makes NO network request while rendering (bundled reference only)", () => {
    refreshTranslations("en");
    render(<DrugDoseReference defaultOpen />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaks no PII (no email / phone patterns in the rendered reference)", () => {
    refreshTranslations("en");
    render(<DrugDoseReference defaultOpen />);
    const text = screen.getByTestId("cb-drug-reference").textContent ?? "";
    expect(text).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i); // email
    // A personal phone number carries ≥10 digits; ISO dates (8) / versions /
    // concentrations do not. Count digits inside each digit+separator run.
    const digitRuns = text.match(/\d[\d\s().+-]{6,}\d/g) ?? [];
    const looksLikePhone = digitRuns.some((run) => run.replace(/\D/g, "").length >= 10);
    expect(looksLikePhone).toBe(false);
  });

  it("renders only VALID entries — an invalid entry is never surfaced as guidance", () => {
    refreshTranslations("en");
    render(<DrugDoseReference defaultOpen />);
    // Every rendered entry testid corresponds to a validation-passing entry.
    for (const entry of DRUG_DOSE_REFERENCE.entries) {
      expect(validateDrugDoseEntry(entry).valid).toBe(true);
      expect(screen.queryByTestId(`cb-drug-entry-${entry.id}`)).not.toBeNull();
    }
  });
});
