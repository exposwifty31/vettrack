/**
 * ADR-011 / migration 186 — per-clinic sequence on `vt_event_outbox`.
 *
 * Asserts the invariant the client now depends on: within one clinic the sequence is
 * contiguous from 1, regardless of how many OTHER clinics interleave writes on the shared
 * global `id`. Also pins the two properties that make it hold — the assignment is a
 * BEFORE INSERT trigger (so BOTH insert paths get it: `insertRealtimeDomainEvent` and the
 * direct audit-row insert at server/lib/audit.ts:398) and a unique index is the backstop.
 *
 * Run: pnpm exec tsx tests/migrations/event-outbox-clinic-seq.test.ts
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
  const clinicA = `adr011-a-${randomUUID().slice(0, 8)}`;
  const clinicB = `adr011-b-${randomUUID().slice(0, 8)}`;

  try {
    // --- column, counter table, trigger and unique index all exist ---
    const col = await pool.query(
      `select data_type from information_schema.columns
       where table_name = 'vt_event_outbox' and column_name = 'clinic_seq'`,
    );
    assert.strictEqual(col.rows.length, 1, "expected vt_event_outbox.clinic_seq to exist");

    const seqTable = await pool.query(`select to_regclass('public.vt_event_outbox_seq') as t`);
    assert.strictEqual(seqTable.rows[0].t, "vt_event_outbox_seq", "expected the counter table");

    const trg = await pool.query(
      `select tgname from pg_trigger
       where tgrelid = 'vt_event_outbox'::regclass and tgname = 'trg_vt_event_outbox_clinic_seq'`,
    );
    assert.strictEqual(trg.rows.length, 1, "expected the clinic_seq assignment trigger");

    const idx = await pool.query(
      `select indexname from pg_indexes
       where tablename = 'vt_event_outbox' and indexname = 'uq_vt_event_outbox_clinic_seq'`,
    );
    assert.strictEqual(idx.rows.length, 1, "expected the (clinic_id, clinic_seq) unique index");

    await pool.query(`insert into vt_clinics (id) values ($1), ($2)`, [clinicA, clinicB]);

    // --- the core property: interleaved clinics, contiguous per-clinic sequences ---
    // A B A B B A — so each clinic's global ids are non-consecutive by construction.
    for (const c of [clinicA, clinicB, clinicA, clinicB, clinicB, clinicA]) {
      await pool.query(
        `insert into vt_event_outbox (clinic_id, type, payload) values ($1, 'PROBE', '{}'::jsonb)`,
        [c],
      );
    }

    for (const clinic of [clinicA, clinicB]) {
      const r = await pool.query(
        `select count(*)::int as n, min(clinic_seq)::int as lo, max(clinic_seq)::int as hi
         from vt_event_outbox where clinic_id = $1`,
        [clinic],
      );
      const { n, lo, hi } = r.rows[0];
      assert.strictEqual(n, 3, `expected 3 rows for ${clinic}`);
      assert.strictEqual(lo, 1, `expected ${clinic} sequence to start at 1, got ${lo}`);
      assert.strictEqual(
        hi - lo + 1,
        n,
        `expected ${clinic} sequence to be contiguous (lo=${lo} hi=${hi} n=${n})`,
      );
    }

    // --- the global id really was non-contiguous for a single clinic ---
    // Without this the assertion above could pass on a sequence that happens to be dense.
    const ids = await pool.query(
      `select id from vt_event_outbox where clinic_id = $1 order by id`,
      [clinicA],
    );
    const idList = ids.rows.map((r: { id: string | number }) => Number(r.id));
    const globalIsContiguous = idList.every((v, i) => i === 0 || v === idList[i - 1] + 1);
    assert.strictEqual(
      globalIsContiguous,
      false,
      `expected clinicA's global ids to have gaps (got ${idList.join(",")}) — otherwise this test proves nothing`,
    );

    // --- a direct insert (the audit.ts path) is sequenced too ---
    const direct = await pool.query(
      `insert into vt_event_outbox (clinic_id, type, payload)
       values ($1, 'audit_log', '{}'::jsonb) returning clinic_seq::int as s`,
      [clinicA],
    );
    assert.strictEqual(direct.rows[0].s, 4, "expected the direct insert path to continue the sequence");

    // --- unique index rejects a duplicate ---
    let rejected = false;
    try {
      await pool.query(
        `insert into vt_event_outbox (clinic_id, type, payload, clinic_seq)
         values ($1, 'DUP', '{}'::jsonb, 1)`,
        [clinicA],
      );
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, "expected a duplicate (clinic_id, clinic_seq) to be rejected");

    console.log("✅ event-outbox clinic_seq migration test passed");
  } finally {
    // CASCADE from vt_clinics removes the outbox rows and the counter rows.
    await pool.query(`delete from vt_clinics where id = any($1)`, [[clinicA, clinicB]]);
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ event-outbox clinic_seq migration test failed");
  console.error(err);
  process.exit(1);
});
