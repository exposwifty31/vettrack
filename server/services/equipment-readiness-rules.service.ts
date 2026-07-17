import { and, eq } from "drizzle-orm";
import { db, equipmentReadinessConfig } from "../db.js";
import {
  parseEquipmentReadinessRulesV1,
  type EquipmentReadinessRulesV1,
} from "../../shared/equipment-readiness-rules.js";

/** Logical config key; clinic scope is enforced by `clinic_id` column, not key suffix. */
export const READINESS_RULES_CONFIG_KEY = "equipment.readinessRules.v1" as const;

/**
 * R-BDF-1.1 — fixed battery-critical threshold (percent) for the board anomaly pass.
 * A device battery reading AT or BELOW this value trips `battery_critical` (equality
 * FIRES). Not owner-configurable in v1 (the v1 rule set + thresholds are fixed); this
 * is the single named source the board producer and its RED fixtures read.
 */
export const BATTERY_CRITICAL_PERCENT = 20;

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

/**
 * Cache-bypassing read for the governance console: returns the parsed rules plus
 * the row's `updatedAt` (null when the clinic still runs on defaults). Admins must
 * see the authoritative row, not a possibly-stale cache entry.
 */
export async function getReadinessRulesWithMeta(
  clinicId: string,
): Promise<{ rules: EquipmentReadinessRulesV1; updatedAt: string | null }> {
  const [row] = await db
    .select({ value: equipmentReadinessConfig.value, updatedAt: equipmentReadinessConfig.updatedAt })
    .from(equipmentReadinessConfig)
    .where(
      and(
        eq(equipmentReadinessConfig.clinicId, clinicId),
        eq(equipmentReadinessConfig.key, READINESS_RULES_CONFIG_KEY),
      ),
    )
    .limit(1);

  return {
    rules: parseEquipmentReadinessRulesV1(row?.value ?? null),
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * Guarded update: read-modify-write so `minimumReadyByType` is preserved when only
 * `staleEvidenceMs` changes. Upserts the (clinic, key) row and clears the cache so
 * the next `getReadinessRules` reflects the change immediately. Returns the new rules.
 */
export async function updateReadinessRules(
  clinicId: string,
  patch: { staleEvidenceMs?: number },
): Promise<EquipmentReadinessRulesV1> {
  const cacheKey = readinessRulesCacheKey(clinicId);
  const current = await getReadinessRules(clinicId);
  const next: EquipmentReadinessRulesV1 = {
    version: 1,
    staleEvidenceMs: patch.staleEvidenceMs ?? current.staleEvidenceMs,
    minimumReadyByType: current.minimumReadyByType,
  };

  const value = JSON.stringify(next);
  await db
    .insert(equipmentReadinessConfig)
    .values({ clinicId, key: READINESS_RULES_CONFIG_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [equipmentReadinessConfig.clinicId, equipmentReadinessConfig.key],
      set: { value, updatedAt: new Date() },
    });

  // Clinic-scoped invalidation (not the global clear) so the next read re-fetches.
  rulesCache.delete(cacheKey);
  return next;
}
