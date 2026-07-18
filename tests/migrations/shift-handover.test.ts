/**
 * R-SH-F1.1 — validates the `vt_shift_handover` table (migration 177).
 *
 * Asserts:
 *   - the table exists and `clinic_id` is NOT NULL (multi-tenancy),
 *   - `notification_read_at` exists, is nullable, and defaults to NULL (unread),
 *   - the unique key on (clinic_id, shift_session_id, revision) rejects a
 *     duplicate triple while allowing a second, monotonic revision to coexist.
 *
 * DB-integration — excluded from `pnpm test`. Run:
 *   DATABASE_URL=… pnpm exec tsx tests/migrations/shift-handover.test.ts
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
    // --- table exists ---
    const reg = await pool.query(`select to_regclass('public.vt_shift_handover') as t`);
    assert.strictEqual(
      reg.rows[0].t,
      "vt_shift_handover",
      "expected vt_shift_handover table to exist",
    );

    // --- clinic_id is NOT NULL ---
    const clinicId = await pool.query(
      `select is_nullable from information_schema.columns
       where table_name = 'vt_shift_handover' and column_name = 'clinic_id'`,
    );
    assert.strictEqual(clinicId.rows.length, 1, "expected clinic_id column to exist");
    assert.strictEqual(
      clinicId.rows[0].is_nullable,
      "NO",
      "expected vt_shift_handover.clinic_id to be NOT NULL",
    );

    // --- notification_read_at exists, nullable, defaults NULL (unread) ---
    const readState = await pool.query(
      `select is_nullable, column_default from information_schema.columns
       where table_name = 'vt_shift_handover' and column_name = 'notification_read_at'`,
    );
    assert.strictEqual(readState.rows.length, 1, "expected notification_read_at column to exist");
    assert.strictEqual(
      readState.rows[0].is_nullable,
      "YES",
      "expected notification_read_at to be nullable",
    );
    assert.strictEqual(
      readState.rows[0].column_default,
      null,
      "expected notification_read_at to default to NULL (unread)",
    );

    // --- unique (clinic_id, shift_session_id, revision) ---
    const clinic = randomUUID();
    const sessionId = "sess-" + randomUUID();
    const insertRevision = (revision: number) =>
      pool.query(
        `insert into vt_shift_handover
           (id, clinic_id, shift_session_id, revision, deltas, patient_worklist)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          clinic,
          sessionId,
          revision,
          JSON.stringify({ custody: [], taskState: [], alerts: [], dispenses: [] }),
          JSON.stringify({ state: "not_configured" }),
        ],
      );

    try {
      await pool.query(`insert into vt_clinics (id) values ($1)`, [clinic]);

      await insertRevision(1);

      // notification_read_at defaults to NULL (unread) for a fresh artifact
      const fresh = await pool.query(
        `select notification_read_at, acknowledged_by, acknowledged_at
         from vt_shift_handover
         where clinic_id = $1 and shift_session_id = $2 and revision = 1`,
        [clinic, sessionId],
      );
      assert.strictEqual(fresh.rows.length, 1);
      assert.strictEqual(fresh.rows[0].notification_read_at, null, "expected unread by default");
      assert.strictEqual(fresh.rows[0].acknowledged_by, null, "expected unacknowledged by default");
      assert.strictEqual(fresh.rows[0].acknowledged_at, null);

      // duplicate (clinic_id, shift_session_id, revision) is rejected
      let dupRejected = false;
      try {
        await insertRevision(1);
      } catch {
        dupRejected = true;
      }
      assert.ok(
        dupRejected,
        "expected unique (clinic_id, shift_session_id, revision) to reject a duplicate triple",
      );

      // a second, monotonic revision coexists with the prior one
      await insertRevision(2);
      const count = await pool.query(
        `select count(*)::int as n from vt_shift_handover
         where clinic_id = $1 and shift_session_id = $2`,
        [clinic, sessionId],
      );
      assert.strictEqual(count.rows[0].n, 2, "expected revisions 1 and 2 to coexist");
    } finally {
      await pool.query(`delete from vt_shift_handover where clinic_id = $1`, [clinic]);
      await pool.query(`delete from vt_clinics where id = $1`, [clinic]);
    }

    console.log("✅ shift-handover.test.ts passed");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
