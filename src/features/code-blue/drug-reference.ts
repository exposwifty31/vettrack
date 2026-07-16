/**
 * R-CBF-1.4 — static, versioned, clinician-approved drug-dose reference for the
 * Code Blue timed log.
 *
 * This is REFERENCE DATA, not a new domain and not user copy:
 *  - it is BUNDLED (no network dependency, no clinic-config in v1 — deferred);
 *  - drug names, doses, concentrations and units are clinical DATA and live
 *    here, NOT in `locales/*.json` (locked by `tests/i18n-code-blue.test.ts` —
 *    `codeBlue.drugs.*` / `codeBlue.units.*` must never appear in the dicts).
 *    Only the surrounding chrome (labels/headings) is localized.
 *
 * CLINICAL SAFETY: stale or unsourced dose guidance is a safety defect. Every
 * entry's provenance is ENFORCED, not optional — `validateDrugDoseEntry` rejects
 * a missing OR empty/placeholder source/owner, a malformed version/effective
 * date, and an out-of-scope species/weight/concentration/unit. Presence alone is
 * never sufficient; the renderer surfaces ONLY validation-passing entries.
 */

export type DrugSpecies = "canine" | "feline";

export type DrugDoseUnit = "mg/kg" | "mcg/kg" | "mL/kg" | "units/kg" | "mEq/kg";

export interface WeightBandKg {
  readonly minKg: number;
  readonly maxKg: number;
}

export interface DrugDoseEntry {
  readonly id: string;
  readonly drug: string;
  readonly indication: string;
  readonly dose: string;
  readonly route: string;
  readonly species: DrugSpecies;
  readonly weightBandKg: WeightBandKg;
  readonly concentration: string;
  readonly unit: DrugDoseUnit;
  // Provenance — all mandatory, all validated.
  readonly source: string;
  readonly version: string;
  /** ISO calendar date `YYYY-MM-DD`. */
  readonly effectiveDate: string;
  readonly reviewOwner: string;
}

export interface DrugDoseReferenceTable {
  readonly version: string;
  readonly effectiveDate: string;
  readonly source: string;
  readonly reviewOwner: string;
  readonly entries: readonly DrugDoseEntry[];
}

export interface DrugDoseValidation {
  readonly valid: boolean;
  readonly errors: string[];
}

const SUPPORTED_SPECIES: ReadonlySet<string> = new Set<DrugSpecies>(["canine", "feline"]);

const SUPPORTED_UNITS: ReadonlySet<string> = new Set<DrugDoseUnit>([
  "mg/kg",
  "mcg/kg",
  "mL/kg",
  "units/kg",
  "mEq/kg",
]);

/** A plausible upper bound for a patient weight band (kg). Guards against typos
 *  like 5000 that would render nonsense dose scope. */
const MAX_WEIGHT_KG = 200;

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reject empty/whitespace strings and common placeholder tokens — a
 *  non-null-but-meaningless source or owner is a provenance failure. */
const PLACEHOLDER_RE = /^(n\/?a|tbd|tba|todo|to ?do|placeholder|unknown|none|null|undefined|test|x+|\?+|-+|\.+)$/i;

function isBlankOrPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return PLACEHOLDER_RE.test(trimmed);
}

function isWellFormedVersion(value: unknown): boolean {
  return typeof value === "string" && VERSION_RE.test(value);
}

function isRealIsoDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through a UTC date to reject non-existent calendar days
  // (e.g. 2026-02-30 normalizes to March 2).
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function isInScopeWeightBand(band: unknown): band is WeightBandKg {
  if (typeof band !== "object" || band === null) return false;
  const { minKg, maxKg } = band as Record<string, unknown>;
  if (typeof minKg !== "number" || typeof maxKg !== "number") return false;
  if (!Number.isFinite(minKg) || !Number.isFinite(maxKg)) return false;
  if (minKg <= 0 || maxKg <= 0) return false;
  if (minKg >= maxKg) return false;
  if (maxKg > MAX_WEIGHT_KG) return false;
  return true;
}

function hasPositiveMagnitude(value: string): boolean {
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? Number(match[1]) > 0 : false;
}

/**
 * Validate one drug-dose entry's clinical provenance and scope. Never throws;
 * returns a boolean plus a field-tagged error list. Accepts `unknown` so hostile
 * or partial input is narrowed safely rather than trusted.
 */
export function validateDrugDoseEntry(entry: unknown): DrugDoseValidation {
  const errors: string[] = [];

  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return { valid: false, errors: ["entry: not an object"] };
  }
  const e = entry as Record<string, unknown>;

  // Clinical identity + dosing scope.
  if (isBlankOrPlaceholder(e.drug)) errors.push("drug: missing or placeholder");
  if (isBlankOrPlaceholder(e.indication)) errors.push("indication: missing or placeholder");
  if (isBlankOrPlaceholder(e.dose)) errors.push("dose: missing or placeholder");
  if (isBlankOrPlaceholder(e.route)) errors.push("route: missing or placeholder");

  if (typeof e.species !== "string" || !SUPPORTED_SPECIES.has(e.species)) {
    errors.push("species: unsupported or out of scope");
  }
  if (!isInScopeWeightBand(e.weightBandKg)) {
    errors.push("weightBandKg: out of scope");
  }
  if (isBlankOrPlaceholder(e.concentration) || !hasPositiveMagnitude(e.concentration as string)) {
    errors.push("concentration: out of scope or missing magnitude");
  }
  if (typeof e.unit !== "string" || !SUPPORTED_UNITS.has(e.unit)) {
    errors.push("unit: unsupported dose unit");
  }

  // Provenance — mandatory, enforced.
  if (isBlankOrPlaceholder(e.source)) errors.push("source: missing or placeholder");
  if (!isWellFormedVersion(e.version)) errors.push("version: malformed");
  if (!isRealIsoDate(e.effectiveDate)) errors.push("effectiveDate: malformed");
  if (isBlankOrPlaceholder(e.reviewOwner)) errors.push("reviewOwner: missing or placeholder");

  return { valid: errors.length === 0, errors };
}

export function isValidDrugDoseEntry(entry: unknown): entry is DrugDoseEntry {
  return validateDrugDoseEntry(entry).valid;
}

/**
 * The bundled, versioned, clinician-approved emergency dose reference.
 *
 * Provenance lives on every row (source / version / effective date / review
 * owner) so a stale or unsourced value can never render as authoritative
 * guidance. Values are locale-independent clinical data; do not translate.
 */
export const DRUG_DOSE_REFERENCE: DrugDoseReferenceTable = {
  version: "1.0.0",
  effectiveDate: "2026-01-15",
  source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
  reviewOwner: "Emergency & Critical Care Lead",
  entries: [
    {
      id: "epinephrine-canine",
      drug: "Epinephrine",
      indication: "Cardiopulmonary arrest — low dose",
      dose: "0.01 mg/kg IV/IO, repeat q3–5min",
      route: "IV/IO",
      species: "canine",
      weightBandKg: { minKg: 2, maxKg: 90 },
      concentration: "1 mg/mL (1:1000)",
      unit: "mg/kg",
      source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
      version: "1.0.0",
      effectiveDate: "2026-01-15",
      reviewOwner: "Emergency & Critical Care Lead",
    },
    {
      id: "epinephrine-feline",
      drug: "Epinephrine",
      indication: "Cardiopulmonary arrest — low dose",
      dose: "0.01 mg/kg IV/IO, repeat q3–5min",
      route: "IV/IO",
      species: "feline",
      weightBandKg: { minKg: 1, maxKg: 12 },
      concentration: "1 mg/mL (1:1000)",
      unit: "mg/kg",
      source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
      version: "1.0.0",
      effectiveDate: "2026-01-15",
      reviewOwner: "Emergency & Critical Care Lead",
    },
    {
      id: "atropine-canine",
      drug: "Atropine",
      indication: "Asystole / bradycardic arrest",
      dose: "0.04 mg/kg IV/IO",
      route: "IV/IO",
      species: "canine",
      weightBandKg: { minKg: 2, maxKg: 90 },
      concentration: "0.54 mg/mL",
      unit: "mg/kg",
      source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
      version: "1.0.0",
      effectiveDate: "2026-01-15",
      reviewOwner: "Emergency & Critical Care Lead",
    },
    {
      id: "atropine-feline",
      drug: "Atropine",
      indication: "Asystole / bradycardic arrest",
      dose: "0.04 mg/kg IV/IO",
      route: "IV/IO",
      species: "feline",
      weightBandKg: { minKg: 1, maxKg: 12 },
      concentration: "0.54 mg/mL",
      unit: "mg/kg",
      source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
      version: "1.0.0",
      effectiveDate: "2026-01-15",
      reviewOwner: "Emergency & Critical Care Lead",
    },
    {
      id: "amiodarone-canine",
      drug: "Amiodarone",
      indication: "Refractory VF / pulseless VT",
      dose: "5 mg/kg IV/IO",
      route: "IV/IO",
      species: "canine",
      weightBandKg: { minKg: 2, maxKg: 90 },
      concentration: "50 mg/mL",
      unit: "mg/kg",
      source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
      version: "1.0.0",
      effectiveDate: "2026-01-15",
      reviewOwner: "Emergency & Critical Care Lead",
    },
    {
      id: "naloxone-canine",
      drug: "Naloxone",
      indication: "Opioid reversal during resuscitation",
      dose: "0.04 mg/kg IV/IO",
      route: "IV/IO",
      species: "canine",
      weightBandKg: { minKg: 2, maxKg: 90 },
      concentration: "0.4 mg/mL",
      unit: "mg/kg",
      source: "RECOVER Clinical CPR Guidelines (2nd ed.)",
      version: "1.0.0",
      effectiveDate: "2026-01-15",
      reviewOwner: "Emergency & Critical Care Lead",
    },
  ],
};

/** The bundled entries that pass provenance validation — the only ones safe to
 *  surface as guidance. */
export function approvedDrugDoseEntries(): DrugDoseEntry[] {
  return DRUG_DOSE_REFERENCE.entries.filter(isValidDrugDoseEntry);
}
