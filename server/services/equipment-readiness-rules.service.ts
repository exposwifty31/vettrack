import { and, eq } from "drizzle-orm";
import { db, equipmentReadinessConfig } from "../db.js";
import {
  parseEquipmentReadinessRulesV1,
  type EquipmentReadinessRulesV1,
} from "../../shared/equipment-readiness-rules.js";

/** Logical config key; clinic scope is enforced by `clinic_id` column, not key suffix. */
export const READINESS_RULES_CONFIG_KEY = "equipment.readinessRules.v1" as const;

const rulesCache = new Map<string, { rules: EquipmentReadinessRulesV1; loadedAt: number }>();
const CACHE_TTL_MS = 60_000;

/** Cache partition: clinic_id + logical key (structural isolation). */
export function readinessRulesCacheKey(clinicId: string): string {
  return `${clinicId}\0${READINESS_RULES_CONFIG_KEY}`;
}

/** Clears in-process cache (tests only). */
export function clearReadinessRulesCache(): void {
  rulesCache.clear();
}

export async function getReadinessRules(clinicId: string): Promise<EquipmentReadinessRulesV1> {
  const cacheKey = readinessRulesCacheKey(clinicId);
  const cached = rulesCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.rules;
  }

  const [row] = await db
    .select({ value: equipmentReadinessConfig.value })
    .from(equipmentReadinessConfig)
    .where(
      and(
        eq(equipmentReadinessConfig.clinicId, clinicId),
        eq(equipmentReadinessConfig.key, READINESS_RULES_CONFIG_KEY),
      ),
    )
    .limit(1);

  const rules = parseEquipmentReadinessRulesV1(row?.value ?? null);
  rulesCache.set(cacheKey, { rules, loadedAt: Date.now() });
  return rules;
}
