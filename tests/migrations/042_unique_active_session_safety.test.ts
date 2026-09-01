/**
 * Validates the pre-check in `042_uniq_active_restock_session_per_container.sql`.
 *
 * Run: pnpm exec tsx tests/migrations/042_unique_active_session_safety.test.ts
 */
import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSafetyDoBlockFromMigration(): string {
  const migrationPath = path.join(__dirname, "../../migrations/042_uniq_active_restock_session_per_container.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");
  const match = sql.match(/DO\s*\$\$[\s\S]*?END\s*\$\$\s*;/);
  assert(match, "expected PRE-MIGRATION SAFETY CHECK DO block in 042 migration");
  return match[0];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️  migration safety tests skipped (DATABASE_URL not set)");
    process.exit(0);
  }

  const { pool } = await import("../../server/db.js");

  try {
    const clinicId = randomUUID();
    const userId = randomUUID();
    const containerId = randomUUID();
    const sess1 = randomUUID();
    const sess2 = randomUUID();

    const restoreIndexSql = `
CREATE UNIQUE INDEX IF NOT EXISTS uniq_restock_session_active_container
ON vt_restock_sessions (container_id)
WHERE status = 'active';
`;

    // Children first — every FK in this graph is ON DELETE RESTRICT.
    const purgeFixture = async () => {
      await pool.query(`DELETE FROM vt_restock_sessions WHERE clinic_id = $1`, [clinicId]);
      await pool.query(`DELETE FROM vt_containers WHERE clinic_id = $1`, [clinicId]);
      await pool.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
      await pool.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
    };

    try {
      await pool.query(`DROP INDEX IF EXISTS uniq_restock_session_active_container`);

      // The clinic must exist before anything references it. Migration
      // 065_core_table_fk_constraints.sql added `vt_users_clinic_id_fk`, so the
      // user insert below — which this file has always made against a freshly
      // generated clinic id — began failing with a foreign-key violation and the
      // suite never reached its assertion. `id` is the only column without a
      // default.
      await pool.query(`INSERT INTO vt_clinics (id) VALUES ($1)`, [clinicId]);

      await pool.query(
        `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name)
       VALUES ($1, $2, $3, $4, 'safety test')`,
        [userId, clinicId, `clerk_${randomUUID()}`, `u_${randomUUID()}@example.com`],
      );
      await pool.query(
        `INSERT INTO vt_containers (id, clinic_id, name, department)
       VALUES ($1, $2, 'Hospital Supply Cart', 'Hospital')`,
        [containerId, clinicId],
      );

      await pool.query(
        `INSERT INTO vt_restock_sessions (id, clinic_id, container_id, owned_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'active'), ($5, $2, $3, $4, 'active')`,
        [sess1, clinicId, containerId, userId, sess2],
      );

      const safetyDoBlock = loadSafetyDoBlockFromMigration();

      let aborted = false;
      try {
        await pool.query(safetyDoBlock);
      } catch (e: unknown) {
        aborted =
          e instanceof Error &&
          /Migration aborted/i.test(e.message) &&
          /multiple active restock sessions/i.test(e.message);
        if (!aborted) throw e;
      }
      assert(aborted, "expected duplicate-active safety check to raise Migration aborted");

      // The re-run below asserts the safety block PASSES once the duplicates are
      // gone, so the purge has to happen here on the success path. It also runs
      // in `finally`, because an assertion above throwing would otherwise leave
      // the clinic and its dependants in the database for every later suite in
      // the same job (review finding on #281). DELETE is idempotent, so running
      // it twice on the success path costs nothing.
      await purgeFixture();

      await pool.query(loadSafetyDoBlockFromMigration());
    } finally {
      await purgeFixture();
      await pool.query(restoreIndexSql);
    }

    const migrationPath = path.join(__dirname, "../../migrations/042_uniq_active_restock_session_per_container.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");
    assert.match(migrationSql, /PRE-MIGRATION SAFETY CHECK/s);
    assert.match(migrationSql, /uniq_restock_session_active_container/s);

    console.log("✅ 042_unique_active_session_safety.test.ts passed");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
