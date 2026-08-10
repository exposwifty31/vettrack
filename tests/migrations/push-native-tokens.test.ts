/**
 * Migration 180_vt_push_subscriptions_native_tokens.sql — ADR-009 (G4-2).
 *
 * Validates the platform-tagged native-token model:
 *   - platform + token columns exist
 *   - endpoint / p256dh / auth are now NULLABLE (native rows carry none)
 *   - a native row (platform='ios', token set, endpoint NULL) is ACCEPTED
 *   - platform DEFAULTS to 'web' when omitted (existing web rows backfill for free)
 *   - the platform CHECK rejects an unknown platform (23514)
 *   - the partial UNIQUE(token) rejects a duplicate native token (23505)
 *
 * DB-integration (DB-gated): needs DATABASE_URL + migrations applied
 * (`pnpm db:migrate` applies 180). Excluded from the default `pnpm test` suite
 * via the tests/migrations/** exclusion in vite.config.ts.
 *
 * Run: pnpm exec tsx tests/migrations/push-native-tokens.test.ts
 */
import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "crypto";

const uid = () => randomUUID();

async function expectReject(fn: () => Promise<unknown>, sqlstatePrefix: string, message: string): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== undefined, `${message} (expected a rejection, but the statement succeeded)`);
  const code = (caught as { code?: unknown }).code;
  assert.ok(
    typeof code === "string" && code.startsWith(sqlstatePrefix),
    `${message} (expected SQLSTATE ${sqlstatePrefix}xxx, got ${String(code)})`,
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️  push-native-tokens migration test skipped (DATABASE_URL not set)");
    process.exit(0);
  }

  const { pool } = await import("../../server/db.js");
  const clinicId = uid();
  const otherClinicId = uid();

  try {
    // --- columns + nullability ---
    const cols = await pool.query(
      `select column_name, is_nullable from information_schema.columns where table_name = 'vt_push_subscriptions'`,
    );
    const nullable = new Map<string, string>(
      cols.rows.map((r: { column_name: string; is_nullable: string }) => [r.column_name, r.is_nullable]),
    );
    assert.ok(nullable.has("platform"), "expected platform column");
    assert.ok(nullable.has("token"), "expected token column");
    assert.strictEqual(nullable.get("endpoint"), "YES", "endpoint must be nullable");
    assert.strictEqual(nullable.get("p256dh"), "YES", "p256dh must be nullable");
    assert.strictEqual(nullable.get("auth"), "YES", "auth must be nullable");

    await pool.query(`insert into vt_clinics (id) values ($1)`, [clinicId]);

    // --- native row with NULL endpoint is valid ---
    const nativeId = uid();
    await pool.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'ios',$4)`,
      [nativeId, clinicId, "u-native", `IOS-${nativeId}`],
    );
    const native = await pool.query(
      `select platform, endpoint from vt_push_subscriptions where id=$1`,
      [nativeId],
    );
    assert.strictEqual(native.rows[0].platform, "ios", "native row platform should be ios");
    assert.strictEqual(native.rows[0].endpoint, null, "native row endpoint should be NULL");

    // --- platform DEFAULTS to 'web' when omitted ---
    const webId = uid();
    await pool.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4,'p','a')`,
      [webId, clinicId, "u-web", `https://push.example/${webId}`],
    );
    const web = await pool.query(`select platform from vt_push_subscriptions where id=$1`, [webId]);
    assert.strictEqual(web.rows[0].platform, "web", "omitted platform should default to web");

    // --- CHECK rejects unknown platform ---
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'windows',$4)`,
          [uid(), clinicId, "u-bad", `TOK-${uid()}`],
        ),
      "23514",
      "unknown platform must violate the CHECK constraint",
    );

    // --- partial UNIQUE(token) rejects a duplicate native token ---
    const dupToken = `DUP-${uid()}`;
    await pool.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'android',$4)`,
      [uid(), clinicId, "u-dup-1", dupToken],
    );
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'android',$4)`,
          [uid(), clinicId, "u-dup-2", dupToken],
        ),
      "23505",
      "duplicate native token must violate the partial UNIQUE index",
    );

    // --- multi-tenancy: a clinic-scoped delete must NOT reach another clinic's row ---
    await pool.query(`insert into vt_clinics (id) values ($1)`, [otherClinicId]);
    const isolatedToken = `ISO-${uid()}`;
    const isolatedId = uid();
    await pool.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'ios',$4)`,
      [isolatedId, clinicId, "u-iso", isolatedToken],
    );
    // Delete scoped to the OTHER clinic + this clinic's token → 0 rows removed (clinicId filter blocks it).
    const crossDelete = await pool.query(
      `delete from vt_push_subscriptions where clinic_id=$1 and token=$2`,
      [otherClinicId, isolatedToken],
    );
    assert.strictEqual(crossDelete.rowCount, 0, "cross-tenant delete must remove 0 rows");
    const survives = await pool.query(`select 1 from vt_push_subscriptions where id=$1`, [isolatedId]);
    assert.strictEqual(survives.rowCount, 1, "the target clinic's row must survive a cross-tenant delete");

    console.log("✅ push-native-tokens migration test passed");
  } finally {
    await pool.query(`delete from vt_push_subscriptions where clinic_id = any($1)`, [[clinicId, otherClinicId]]);
    await pool.query(`delete from vt_clinics where id = any($1)`, [[clinicId, otherClinicId]]);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
