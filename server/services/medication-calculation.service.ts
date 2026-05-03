import { and, eq, isNull } from "drizzle-orm";
import { db, drugFormulary } from "../db.js";
import { doseDeviationRatio, justificationTier, requiresDoseJustification, type JustificationTier } from "../../shared/medication-justification.js";
import type { DrugDoseUnit } from "../../shared/drug-formulary-seed.js";

const DOSE_DEVIATION_WARNING_THRESHOLD = 0.2;
const DOSE_DEVIATION_CRITICAL_THRESHOLD = 0.35;
const DOSE_DEVIATION_BLOCK_THRESHOLD = 0.5;

/** Absolute sanity bound for calculated draw volume (ml). */
const MAX_SAFE_VOLUME_ML = 100;

export type CalculationSafetyLevel = "safe" | "warning" | "critical" | "blocked";

/**
 * Two calculation paths are supported:
 *
 * Path A — direct doseMg (vet enters total mg to administer):
 *   calculatedVolume = doseMg / concentrationMgPerMl
 *   weightKg must be provided for audit storage but does NOT drive the formula.
 *
 * Path B — mg/kg (vet enters dose per kg body weight):
 *   calculatedVolume = (weightKg * prescribedDosePerKg) / concentrationMgPerMl
 *
 * Safety deviation is always computed against the formulary standard dose to
 * produce the same safety levels regardless of input path.
 */
export interface MedicationCalculationInput {
  clinicId: string;
  drugId: string;
  /** Body weight — always required for audit/clinical context; drives formula in mg/kg path. */
  weightKg: number;
  doseUnit: DrugDoseUnit | "direct_mg";
  /**
   * Path A (direct_mg): total mg to give. Formula: volume = doseMg / concentration.
   * Path B (mg_per_kg / mcg_per_kg / mEq_per_kg / tablet): dose per kg.
   */
  prescribedDosePerKg: number;
  concentrationMgPerMl?: number;
}

export interface CalculationResult {
  outputUnit?: "ml" | "tablet";
  /** Formulary row referenced during this calculation. Populated by calculateMedication(). */
  formularyId?: string;
  /** Formulary version at calculation time. Populated by calculateMedication(). */
  formularyVersion?: number;
  breakdown: {
    weightKg: number;
    prescribedDosePerKg: number;
    prescribedDoseMgPerKg: number;
    standardDosePerKg: number;
    standardDoseMgPerKg: number;
    concentrationMgPerMl: number;
    /** Set for direct_mg path — the exact mg value entered by the vet. */
    doseMg?: number;
    /** Calculation path used. */
    calculationPath: "direct_mg" | "mg_per_kg";
  };
  final: {
    volumeMl: number;
    totalDoseMg: number;
    roundedVolumeMl: number;
    /** Convenience alias matching the intended snapshot spec. */
    calculatedVolume: number;
  };
  safety: {
    level: CalculationSafetyLevel;
    requiresReason: boolean;
    blocked: boolean;
    deviationRatio: number;
    justificationTier: JustificationTier;
    /** Human-readable clinical message for the safety level. */
    warningMessage?: string;
  };
}

export class MedicationCalculationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MedicationCalculationError";
  }
}

function convertDoseToMgPerKg(dosePerKg: number, unit: DrugDoseUnit): number {
  if (unit === "mcg_per_kg") return dosePerKg / 1000;
  return dosePerKg;
}

function calculateMedicationVolumeMl(params: {
  weightKg: number;
  prescribedDoseMgPerKg: number;
  concentrationMgPerMl: number;
}): number {
  const { weightKg, prescribedDoseMgPerKg, concentrationMgPerMl } = params;
  return (weightKg * prescribedDoseMgPerKg) / concentrationMgPerMl;
}

function resolveSafetyLevel(deviationRatio: number): CalculationSafetyLevel {
  if (deviationRatio > DOSE_DEVIATION_BLOCK_THRESHOLD) return "blocked";
  if (deviationRatio > DOSE_DEVIATION_CRITICAL_THRESHOLD) return "critical";
  if (deviationRatio > DOSE_DEVIATION_WARNING_THRESHOLD) return "warning";
  return "safe";
}

function buildSafetyWarningMessage(level: CalculationSafetyLevel, deviationRatio: number): string | undefined {
  const pct = Math.round(deviationRatio * 100);
  switch (level) {
    case "warning":
      return `Dose is ${pct}% above the standard range. Override reason required.`;
    case "critical":
      return `Dose is ${pct}% above the standard range — critically high deviation. Override reason is mandatory.`;
    case "blocked":
      return `Dose is ${pct}% above the standard range and exceeds the safe threshold. This dose cannot be administered.`;
    default:
      return undefined;
  }
}

export async function calculateMedication(input: MedicationCalculationInput): Promise<CalculationResult> {
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    throw new MedicationCalculationError("INVALID_WEIGHT", 400, "Weight must be a positive number.");
  }
  if (!Number.isFinite(input.prescribedDosePerKg) || input.prescribedDosePerKg <= 0) {
    throw new MedicationCalculationError("INVALID_DOSE", 400, "Prescribed dose must be a positive number.");
  }

  const [drug] = await db
    .select({
      id: drugFormulary.id,
      concentrationMgMl: drugFormulary.concentrationMgMl,
      standardDose: drugFormulary.standardDose,
      doseUnit: drugFormulary.doseUnit,
      version: drugFormulary.version,
      isActive: drugFormulary.isActive,
    })
    .from(drugFormulary)
    .where(
      and(
        eq(drugFormulary.id, input.drugId),
        eq(drugFormulary.clinicId, input.clinicId),
        isNull(drugFormulary.deletedAt),
      ),
    )
    .limit(1);

  if (!drug) {
    throw new MedicationCalculationError("DRUG_NOT_FOUND", 404, "Drug formulary record was not found.");
  }

  const standardDosePerKg = Number(drug.standardDose);
  const standardDoseUnit = drug.doseUnit as DrugDoseUnit;
  const concentrationMgPerMl = input.concentrationMgPerMl ?? Number(drug.concentrationMgMl);

  if (!Number.isFinite(concentrationMgPerMl) || concentrationMgPerMl <= 0) {
    throw new MedicationCalculationError("INVALID_CONCENTRATION", 400, "Concentration must be a positive number.");
  }

  const standardDoseMgPerKg = convertDoseToMgPerKg(standardDosePerKg, standardDoseUnit);

  // ── PATH A: direct doseMg ───────────────────────────────────────────────────
  if (input.doseUnit === "direct_mg") {
    const doseMg = input.prescribedDosePerKg; // field reused for direct mg value
    const volumeMl = doseMg / concentrationMgPerMl;

    if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
      throw new MedicationCalculationError("INVALID_VOLUME", 400, "Calculated volume must be greater than 0 ml.");
    }
    if (volumeMl >= MAX_SAFE_VOLUME_ML) {
      throw new MedicationCalculationError(
        "VOLUME_EXCEEDS_LIMIT",
        400,
        `Calculated volume ${volumeMl.toFixed(2)} ml exceeds safe upper bound (${MAX_SAFE_VOLUME_ML} ml).`,
      );
    }

    const safeVolume = Number(volumeMl.toFixed(2));
    // For safety deviation: treat doseMg/kg as total_mg / weight
    const prescribedDoseMgPerKg = doseMg / input.weightKg;
    const deviationRatio = standardDoseMgPerKg > 0
      ? doseDeviationRatio(prescribedDoseMgPerKg, standardDoseMgPerKg)
      : 0;
    const level = resolveSafetyLevel(deviationRatio);
    const tier = justificationTier(deviationRatio);

    return {
      formularyId: drug.id,
      formularyVersion: drug.version,
      breakdown: {
        weightKg: input.weightKg,
        prescribedDosePerKg: prescribedDoseMgPerKg,
        prescribedDoseMgPerKg,
        standardDosePerKg,
        standardDoseMgPerKg,
        concentrationMgPerMl,
        doseMg,
        calculationPath: "direct_mg",
      },
      final: {
        volumeMl: safeVolume,
        totalDoseMg: doseMg,
        roundedVolumeMl: safeVolume,
        calculatedVolume: safeVolume,
      },
      safety: {
        level,
        requiresReason: requiresDoseJustification(prescribedDoseMgPerKg, standardDoseMgPerKg),
        blocked: level === "blocked",
        deviationRatio,
        justificationTier: tier,
        warningMessage: buildSafetyWarningMessage(level, deviationRatio),
      },
      outputUnit: "ml" as const,
    };
  }

  // ── PATH B: tablet dosing ───────────────────────────────────────────────────
  if (input.doseUnit === "tablet" || standardDoseUnit === "tablet") {
    const rawTablets = input.weightKg * input.prescribedDosePerKg;
    if (!Number.isFinite(rawTablets) || rawTablets <= 0) {
      throw new MedicationCalculationError("INVALID_VOLUME", 400, "Calculated tablet count must be greater than 0.");
    }
    const roundedTablets = Math.round(rawTablets * 4) / 4;
    const totalDoseMgTablet = roundedTablets * concentrationMgPerMl;
    const prescribedDoseMgPerKg = convertDoseToMgPerKg(input.prescribedDosePerKg, input.doseUnit as DrugDoseUnit);
    const deviationRatio = doseDeviationRatio(prescribedDoseMgPerKg, standardDoseMgPerKg);
    const level = resolveSafetyLevel(deviationRatio);
    const tier = justificationTier(deviationRatio);

    return {
      formularyId: drug.id,
      formularyVersion: drug.version,
      breakdown: {
        weightKg: input.weightKg,
        prescribedDosePerKg: input.prescribedDosePerKg,
        prescribedDoseMgPerKg,
        standardDosePerKg,
        standardDoseMgPerKg,
        concentrationMgPerMl,
        calculationPath: "mg_per_kg",
      },
      final: {
        volumeMl: roundedTablets,
        totalDoseMg: totalDoseMgTablet,
        roundedVolumeMl: roundedTablets,
        calculatedVolume: roundedTablets,
      },
      safety: {
        level,
        requiresReason: requiresDoseJustification(prescribedDoseMgPerKg, standardDoseMgPerKg),
        blocked: level === "blocked",
        deviationRatio,
        justificationTier: tier,
        warningMessage: buildSafetyWarningMessage(level, deviationRatio),
      },
      outputUnit: "tablet" as const,
    };
  }

  // ── PATH B: mg/kg liquid ────────────────────────────────────────────────────
  const prescribedDoseMgPerKg = convertDoseToMgPerKg(input.prescribedDosePerKg, input.doseUnit as DrugDoseUnit);
  const deviationRatio = doseDeviationRatio(prescribedDoseMgPerKg, standardDoseMgPerKg);
  const level = resolveSafetyLevel(deviationRatio);

  const volumeMl = calculateMedicationVolumeMl({
    weightKg: input.weightKg,
    prescribedDoseMgPerKg,
    concentrationMgPerMl,
  });
  if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
    throw new MedicationCalculationError("INVALID_VOLUME", 400, "Calculated volume must be greater than 0 ml.");
  }
  if (volumeMl >= MAX_SAFE_VOLUME_ML) {
    throw new MedicationCalculationError(
      "VOLUME_EXCEEDS_LIMIT",
      400,
      `Calculated volume ${volumeMl.toFixed(2)} ml exceeds safe upper bound (${MAX_SAFE_VOLUME_ML} ml). Verify dose and concentration.`,
    );
  }
  const safeVolume = Number(volumeMl.toFixed(2));
  const totalDoseMg = input.weightKg * prescribedDoseMgPerKg;
  const tier = justificationTier(deviationRatio);

  return {
    formularyId: drug.id,
    formularyVersion: drug.version,
    breakdown: {
      weightKg: input.weightKg,
      prescribedDosePerKg: input.prescribedDosePerKg,
      prescribedDoseMgPerKg,
      standardDosePerKg,
      standardDoseMgPerKg,
      concentrationMgPerMl,
      calculationPath: "mg_per_kg",
    },
    final: {
      volumeMl: safeVolume,
      totalDoseMg,
      roundedVolumeMl: safeVolume,
      calculatedVolume: safeVolume,
    },
    safety: {
      level,
      requiresReason: requiresDoseJustification(prescribedDoseMgPerKg, standardDoseMgPerKg),
      blocked: level === "blocked",
      deviationRatio,
      justificationTier: tier,
      warningMessage: buildSafetyWarningMessage(level, deviationRatio),
    },
    outputUnit: "ml" as const,
  };
}
