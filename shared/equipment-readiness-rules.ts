/** Clinic-scoped readiness rules (`equipment.readinessRules.v1`). */
export type EquipmentReadinessRulesV1 = {
  version: 1;
  staleEvidenceMs: number;
  minimumReadyByType: Record<string, number>;
};

export const DEFAULT_EQUIPMENT_READINESS_RULES_V1: EquipmentReadinessRulesV1 = {
  version: 1,
  staleEvidenceMs: 86_400_000,
  minimumReadyByType: {},
};

/** Governance edit bounds for `staleEvidenceMs` (1 minute … 90 days). Shared so
 *  the server validator and the console input agree on the accepted range. */
export const MIN_STALE_EVIDENCE_MS = 60_000;
export const MAX_STALE_EVIDENCE_MS = 90 * 86_400_000;

export function isValidStaleEvidenceMs(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_STALE_EVIDENCE_MS && n <= MAX_STALE_EVIDENCE_MS;
}

export function parseEquipmentReadinessRulesV1(raw: string | null): EquipmentReadinessRulesV1 {
  if (!raw?.trim()) return DEFAULT_EQUIPMENT_READINESS_RULES_V1;
  try {
    const parsed = JSON.parse(raw) as Partial<EquipmentReadinessRulesV1>;
    if (parsed.version !== 1) return DEFAULT_EQUIPMENT_READINESS_RULES_V1;
    return {
      version: 1,
      staleEvidenceMs:
        typeof parsed.staleEvidenceMs === "number" && parsed.staleEvidenceMs > 0
          ? parsed.staleEvidenceMs
          : DEFAULT_EQUIPMENT_READINESS_RULES_V1.staleEvidenceMs,
      minimumReadyByType:
        parsed.minimumReadyByType && typeof parsed.minimumReadyByType === "object"
          ? parsed.minimumReadyByType
          : {},
    };
  } catch {
    return DEFAULT_EQUIPMENT_READINESS_RULES_V1;
  }
}
