import type { AssetTypeCondition, UnitConditionState } from "../db.js";

export type BundleReadinessResult =
  | { ok: true }
  | { skipped: true; reason: "FEATURE_DISABLED" }
  | {
      ok: false;
      reason:
        | "CUSTODY_CHAIN_BROKEN"
        | "NO_ASSET_TYPE_DEFINED"
        | "NO_CONDITIONS_DEFINED"
        | "CONDITIONS_NOT_MET";
      failedConditions: string[];
      staleConditions: string[];
      unknownConditions: string[];
    };

export type CustodyState = "docked" | "checked_out" | "untracked" | "returned";
export type ReadinessState = "ready" | "not_ready" | "unknown";
export type UsageState = "available" | "staged" | "in_use" | "emergency_use" | "procedure_bound";

export interface DeployabilityInput {
  custodyState: string;
  assetTypeId: string | null | undefined;
}

function isStale(verifiedAt: Date, staleAfterMinutes: number, now: Date): boolean {
  const ageMs = now.getTime() - verifiedAt.getTime();
  return ageMs > staleAfterMinutes * 60 * 1000;
}

export function computeBundleReadinessGate(
  equipment: DeployabilityInput,
  unitConditionStates: UnitConditionState[],
  assetTypeConditions: AssetTypeCondition[],
  now: Date,
  featureEnabled: boolean,
): BundleReadinessResult {
  if (!featureEnabled) return { skipped: true, reason: "FEATURE_DISABLED" };

  if (equipment.custodyState !== "docked") {
    return {
      ok: false,
      reason: equipment.custodyState === "untracked" ? "CUSTODY_CHAIN_BROKEN" : "CONDITIONS_NOT_MET",
      failedConditions: [],
      staleConditions: [],
      unknownConditions: assetTypeConditions.map((c) => c.conditionName),
    };
  }

  if (!equipment.assetTypeId) {
    return {
      ok: false,
      reason: "NO_ASSET_TYPE_DEFINED",
      failedConditions: [],
      staleConditions: [],
      unknownConditions: [],
    };
  }

  if (assetTypeConditions.length === 0) {
    return {
      ok: false,
      reason: "NO_CONDITIONS_DEFINED",
      failedConditions: [],
      staleConditions: [],
      unknownConditions: [],
    };
  }

  const mismatch = assetTypeConditions.find((c) => c.assetTypeId !== equipment.assetTypeId);
  if (mismatch) {
    throw new Error("INVARIANT: conditions do not match equipment assetTypeId");
  }

  const failedConditions: string[] = [];
  const staleConditions: string[] = [];
  const unknownConditions: string[] = [];

  for (const condition of assetTypeConditions) {
    const state = unitConditionStates.find((s) => s.conditionId === condition.id);
    if (!state) {
      unknownConditions.push(condition.conditionName);
    } else if (!state.verified) {
      failedConditions.push(condition.conditionName);
    } else if (state.verifiedAt && isStale(state.verifiedAt, condition.staleAfterMinutes, now)) {
      staleConditions.push(condition.conditionName);
    } else if (!state.verifiedAt) {
      // verified=true but no verifiedAt — treat as unknown (shouldn't happen due to DB check constraint)
      unknownConditions.push(condition.conditionName);
    }
  }

  if (failedConditions.length || staleConditions.length || unknownConditions.length) {
    return {
      ok: false,
      reason: "CONDITIONS_NOT_MET",
      failedConditions,
      staleConditions,
      unknownConditions,
    };
  }
  return { ok: true };
}

export function isEquipmentFullyDeployable(
  custodyState: string,
  readinessState: string,
  usageState: string,
): boolean {
  return custodyState === "docked" && readinessState === "ready" && usageState === "available";
}

export function computeStagingExpiry(
  priority: string,
  now: Date,
): Date | null {
  if (priority === "routine") {
    return new Date(now.getTime() + 20 * 60 * 1000);
  }
  if (priority === "urgent") {
    return new Date(now.getTime() + 10 * 60 * 1000);
  }
  return null; // emergency: no expiry
}

export function isOperationalStateFeatureEnabled(): boolean {
  const val = process.env.DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1;
  if (!val) return true;
  const normalized = val.trim().toLowerCase();
  return !(normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on");
}
