import { describe, expect, it } from "vitest";
import {
  DEFAULT_EQUIPMENT_READINESS_RULES_V1,
  parseEquipmentReadinessRulesV1,
} from "../shared/equipment-readiness-rules.js";
import {
  READINESS_RULES_CONFIG_KEY,
  readinessRulesCacheKey,
} from "../server/services/equipment-readiness-rules.service.js";

const clinicA = "clinic-readiness-a";
const clinicB = "clinic-readiness-b";

describe("equipment readiness rules (unit)", () => {
  it("uses a constant logical key separate from clinic_id", () => {
    expect(READINESS_RULES_CONFIG_KEY).toBe("equipment.readinessRules.v1");
    expect(READINESS_RULES_CONFIG_KEY).not.toContain(clinicA);
  });

  it("cache key includes clinic_id and logical key", () => {
    expect(readinessRulesCacheKey(clinicA)).toBe(`${clinicA}\0${READINESS_RULES_CONFIG_KEY}`);
    expect(readinessRulesCacheKey(clinicA)).not.toBe(readinessRulesCacheKey(clinicB));
  });

  it("parses v1 JSON or falls back to defaults", () => {
    expect(parseEquipmentReadinessRulesV1(null)).toEqual(DEFAULT_EQUIPMENT_READINESS_RULES_V1);
    expect(
      parseEquipmentReadinessRulesV1(
        JSON.stringify({ version: 1, staleEvidenceMs: 60_000, minimumReadyByType: { pump: 2 } }),
      ).minimumReadyByType.pump,
    ).toBe(2);
  });
});
