/**
 * PR4: structural clinic isolation for equipment readiness config.
 * Requires DATABASE_URL and migration 146 applied.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { db, equipmentReadinessConfig } from "../server/db.js";
import {
  READINESS_RULES_CONFIG_KEY,
  clearReadinessRulesCache,
  getReadinessRules,
} from "../server/services/equipment-readiness-rules.service.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://vettrack:vettrack@localhost:5432/vettrack";

const clinicA = `clinic-readiness-iso-a-${Date.now()}`;
const clinicB = `clinic-readiness-iso-b-${Date.now()}`;

let probePool: Pool | null = null;
let dbReachable = false;
let tableExists = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000, max: 3 });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
    const { rows } = await probePool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'vt_equipment_readiness_config'
       ) AS exists`,
    );
    tableExists = rows[0]?.exists === true;
    if (tableExists) {
      await probePool.query(`INSERT INTO vt_clinics (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [
        clinicA,
        clinicB,
      ]);
    }
  } catch {
    dbReachable = false;
  }
}

afterAll(async () => {
  if (probePool && dbReachable && tableExists) {
    await probePool.query(`DELETE FROM vt_equipment_readiness_config WHERE clinic_id IN ($1, $2)`, [
      clinicA,
      clinicB,
    ]);
    await probePool.query(`DELETE FROM vt_clinics WHERE id IN ($1, $2)`, [clinicA, clinicB]);
  }
  await probePool?.end();
});

describe.skipIf(!dbReachable || !tableExists)("equipment readiness rules clinic isolation", () => {
  afterEach(async () => {
    clearReadinessRulesCache();
    await probePool?.query(`DELETE FROM vt_equipment_readiness_config WHERE clinic_id IN ($1, $2)`, [
      clinicA,
      clinicB,
    ]);
  });

  it("reads rows scoped by clinic_id and key without cross-clinic leakage", async () => {
    await db.insert(equipmentReadinessConfig).values([
      {
        clinicId: clinicA,
        key: READINESS_RULES_CONFIG_KEY,
        value: JSON.stringify({
          version: 1,
          staleEvidenceMs: 60_000,
          minimumReadyByType: { pump: 2 },
        }),
      },
      {
        clinicId: clinicB,
        key: READINESS_RULES_CONFIG_KEY,
        value: JSON.stringify({
          version: 1,
          staleEvidenceMs: 120_000,
          minimumReadyByType: { vent: 1 },
        }),
      },
    ]);

    const rulesA = await getReadinessRules(clinicA);
    const rulesB = await getReadinessRules(clinicB);

    expect(rulesA.staleEvidenceMs).toBe(60_000);
    expect(rulesA.minimumReadyByType.pump).toBe(2);
    expect(rulesB.staleEvidenceMs).toBe(120_000);
    expect(rulesB.minimumReadyByType.vent).toBe(1);
    expect(rulesB.minimumReadyByType.pump).toBeUndefined();
  });

  it("enforces uniqueness on (clinic_id, key) — same key allowed per clinic", async () => {
    await db.insert(equipmentReadinessConfig).values({
      clinicId: clinicA,
      key: READINESS_RULES_CONFIG_KEY,
      value: JSON.stringify({ version: 1, staleEvidenceMs: 30_000, minimumReadyByType: {} }),
    });
    await db.insert(equipmentReadinessConfig).values({
      clinicId: clinicB,
      key: READINESS_RULES_CONFIG_KEY,
      value: JSON.stringify({ version: 1, staleEvidenceMs: 40_000, minimumReadyByType: {} }),
    });

    const rows = await db
      .select({
        clinicId: equipmentReadinessConfig.clinicId,
        key: equipmentReadinessConfig.key,
      })
      .from(equipmentReadinessConfig)
      .where(eq(equipmentReadinessConfig.key, READINESS_RULES_CONFIG_KEY));

    const matching = rows.filter((r) => r.clinicId === clinicA || r.clinicId === clinicB);
    expect(matching).toHaveLength(2);
    expect(new Set(matching.map((r) => r.clinicId))).toEqual(new Set([clinicA, clinicB]));
  });

  it("select uses separate clinic_id and key predicates", async () => {
    await db.insert(equipmentReadinessConfig).values({
      clinicId: clinicA,
      key: READINESS_RULES_CONFIG_KEY,
      value: JSON.stringify({ version: 1, staleEvidenceMs: 10_000, minimumReadyByType: {} }),
    });

    const { rows } = await probePool!.query<{ clinic_id: string; key: string }>(
      `SELECT clinic_id, key FROM vt_equipment_readiness_config
       WHERE clinic_id = $1 AND key = $2`,
      [clinicA, READINESS_RULES_CONFIG_KEY],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clinic_id).toBe(clinicA);
    expect(rows[0]?.key).toBe(READINESS_RULES_CONFIG_KEY);
  });

  it("in-process cache does not bleed across clinic_id", async () => {
    await db.insert(equipmentReadinessConfig).values({
      clinicId: clinicA,
      key: READINESS_RULES_CONFIG_KEY,
      value: JSON.stringify({ version: 1, staleEvidenceMs: 55_000, minimumReadyByType: {} }),
    });
    await getReadinessRules(clinicA);

    await db
      .update(equipmentReadinessConfig)
      .set({
        value: JSON.stringify({ version: 1, staleEvidenceMs: 999_000, minimumReadyByType: {} }),
      })
      .where(eq(equipmentReadinessConfig.clinicId, clinicA));

    await db.insert(equipmentReadinessConfig).values({
      clinicId: clinicB,
      key: READINESS_RULES_CONFIG_KEY,
      value: JSON.stringify({ version: 1, staleEvidenceMs: 77_000, minimumReadyByType: {} }),
    });

    expect((await getReadinessRules(clinicA)).staleEvidenceMs).toBe(55_000);
    expect((await getReadinessRules(clinicB)).staleEvidenceMs).toBe(77_000);
  });
});
