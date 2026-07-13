/**
 * Validates the `vt_damage_events` table and the additive `vt_equipment.condition_status`
 * column introduced for T-24a (R-EQ-F3).
 *
 * Run: pnpm exec tsx tests/migrations/damage-events.test.ts
 */
import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "crypto";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️  migration test skipped (DATABASE_URL not set)");
    process.exit(0);
  }

  const { pool } = await import("../../server/db.js");

  try {
    // --- vt_damage_events table exists ---
    const tableExists = await pool.query(
      `select to_regclass('public.vt_damage_events') as t`,
    );
    assert.strictEqual(
      tableExists.rows[0].t,
      "vt_damage_events",
      "expected vt_damage_events table to exist",
    );

    // --- clinic_id is NOT NULL on vt_damage_events ---
    const clinicIdNullability = await pool.query(
      `select is_nullable from information_schema.columns
       where table_name = 'vt_damage_events' and column_name = 'clinic_id'`,
    );
    assert.strictEqual(clinicIdNullability.rows.length, 1, "expected clinic_id column to exist");
    assert.strictEqual(
      clinicIdNullability.rows[0].is_nullable,
      "NO",
      "expected vt_damage_events.clinic_id to be NOT NULL",
    );

    // --- condition_status column exists on vt_equipment with a preserving default ---
    const conditionStatusColumn = await pool.query(
      `select column_default, is_nullable from information_schema.columns
       where table_name = 'vt_equipment' and column_name = 'condition_status'`,
    );
    assert.strictEqual(
      conditionStatusColumn.rows.length,
      1,
      "expected vt_equipment.condition_status column to exist",
    );
    assert.strictEqual(
      conditionStatusColumn.rows[0].is_nullable,
      "NO",
      "expected vt_equipment.condition_status to be NOT NULL",
    );
    assert.ok(
      conditionStatusColumn.rows[0].column_default,
      "expected vt_equipment.condition_status to have a default value",
    );

    // --- existing rows remain valid after the migration (default backfills condition_status) ---
    const clinicId = randomUUID();
    const equipmentId = randomUUID();
    try {
      await pool.query(`insert into vt_clinics (id) values ($1)`, [clinicId]);
      // Insert without specifying condition_status — simulates a pre-existing row after migration.
      await pool.query(
        `insert into vt_equipment (id, clinic_id, name) values ($1, $2, 'Test Device')`,
        [equipmentId, clinicId],
      );

      const backfilled = await pool.query(
        `select condition_status from vt_equipment where id = $1`,
        [equipmentId],
      );
      assert.strictEqual(backfilled.rows.length, 1);
      assert.ok(
        backfilled.rows[0].condition_status,
        "expected condition_status to be backfilled by its default for existing-shaped rows",
      );

      // --- insert a damage event referencing the equipment row ---
      const damageEventId = randomUUID();
      await pool.query(
        `insert into vt_damage_events (id, clinic_id, equipment_id, reported_by, at, note)
         values ($1, $2, $3, $4, now(), 'cracked housing')`,
        [damageEventId, clinicId, equipmentId, "test-user"],
      );

      const damageEvent = await pool.query(
        `select id, clinic_id, equipment_id, reported_by, at, note, resolved_at
         from vt_damage_events where id = $1`,
        [damageEventId],
      );
      assert.strictEqual(damageEvent.rows.length, 1);
      assert.strictEqual(damageEvent.rows[0].resolved_at, null);
    } finally {
      await pool.query(`delete from vt_damage_events where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_equipment where clinic_id = $1`, [clinicId]);
      await pool.query(`delete from vt_clinics where id = $1`, [clinicId]);
    }

    console.log("✅ damage-events.test.ts passed");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
