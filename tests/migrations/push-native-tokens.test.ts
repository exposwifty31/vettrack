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
import { readFileSync } from "node:fs";
import { randomUUID } from "crypto";
import type { Pool } from "pg";

const uid = () => randomUUID();

/**
 * Migration-TRANSITION coverage: run migration 180 against an ISOLATED pre-180
 * schema (the web-only shape vt_push_subscriptions had before 180) and assert it
 * applies AND backfills a pre-existing web row — before the post-migration
 * assertions below exercise the already-migrated live table.
 *
 * The repo has no reusable pre-migration harness (the other migration tests are
 * static SQL text-matchers), so this builds a minimal FAITHFUL SUBSET — only the
 * columns migration 180 touches — in a uniquely named schema on its own pooled
 * client, and tears it down fully here (search_path reset + DROP SCHEMA CASCADE)
 * so it never touches the shared public-schema fixtures. No rollback is executed.
 */
async function assertMigrationAppliesToPreMigrationSchema(pool: Pool): Promise<void> {
  const migrationSql = readFileSync(
    new URL("../../migrations/180_vt_push_subscriptions_native_tokens.sql", import.meta.url),
    "utf8",
  );
  const schema = `push_mig_${uid().replace(/-/g, "")}`;
  const client = await pool.connect();
  try {
    // Isolated schema, search_path set to it ALONE (no public): migration 180's
    // unqualified `DROP INDEX IF EXISTS ux_vt_push_subscriptions_token` would
    // otherwise fall through to public and drop the real index. Built-in types
    // resolve via pg_catalog (always implicitly on the path); nothing in 180 needs
    // public, and the pre-migration table uses plain text (no FK to public).
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);

    // Pre-180 web-only shape: endpoint/p256dh/auth NOT NULL, no platform, no token.
    await client.query(
      `CREATE TABLE vt_push_subscriptions (
         id text PRIMARY KEY,
         clinic_id text NOT NULL,
         user_id text NOT NULL,
         endpoint text NOT NULL,
         p256dh text NOT NULL,
         auth text NOT NULL
       )`,
    );

    // A pre-existing web row that must survive the migration and backfill to 'web'.
    const webRowId = uid();
    await client.query(
      `INSERT INTO vt_push_subscriptions (id, clinic_id, user_id, endpoint, p256dh, auth)
         VALUES ($1,$2,$3,$4,'p','a')`,
      [webRowId, uid(), "u-pre", `https://push.example/${webRowId}`],
    );

    // Apply migration 180 (multi-statement, no params — same path as server/migrate.ts).
    await client.query(migrationSql);

    // platform + token added; the web-push triple relaxed to nullable.
    const cols = await client.query(
      `select column_name, is_nullable from information_schema.columns
        where table_schema=$1 and table_name='vt_push_subscriptions'`,
      [schema],
    );
    const nullable = new Map<string, string>(
      cols.rows.map((r: { column_name: string; is_nullable: string }) => [r.column_name, r.is_nullable]),
    );
    assert.ok(nullable.has("platform"), "migration must add the platform column");
    assert.ok(nullable.has("token"), "migration must add the token column");
    assert.strictEqual(nullable.get("endpoint"), "YES", "endpoint must become nullable");
    assert.strictEqual(nullable.get("p256dh"), "YES", "p256dh must become nullable");
    assert.strictEqual(nullable.get("auth"), "YES", "auth must become nullable");

    // The pre-existing web row backfilled to platform='web' and still satisfies the
    // new platform-columns CHECK (endpoint/p256dh/auth set, token NULL).
    const backfilled = await client.query(`select platform from vt_push_subscriptions where id=$1`, [webRowId]);
    assert.strictEqual(backfilled.rows[0].platform, "web", "pre-existing web row must backfill to platform=web");

    // Post-migration the table now ACCEPTS a native row (token only, web cols NULL).
    const nativeId = uid();
    await client.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'ios',$4)`,
      [nativeId, uid(), "u-native-pre", `IOS-${nativeId}`],
    );
    const native = await client.query(`select platform, endpoint from vt_push_subscriptions where id=$1`, [nativeId]);
    assert.strictEqual(native.rows[0].platform, "ios", "native row must insert post-migration");
    assert.strictEqual(native.rows[0].endpoint, null, "native row endpoint must be NULL");

    console.log("✅ migration 180 applies to an isolated pre-migration schema (web row backfilled)");
  } finally {
    // Restore session state and drop the isolated schema so nothing leaks into the shared
    // public-schema fixtures. Attempt BOTH ops independently (a failed RESET must not skip the
    // DROP), capture any failure instead of swallowing it, always release the client so the pool
    // isn't starved, then fail the test if either op errored — a silently-leaked schema would
    // otherwise pass unnoticed.
    const cleanupErrors: string[] = [];
    try {
      await client.query(`RESET search_path`);
    } catch (err) {
      cleanupErrors.push(`RESET search_path: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch (err) {
      cleanupErrors.push(`DROP SCHEMA "${schema}": ${err instanceof Error ? err.message : String(err)}`);
    }
    client.release();
    if (cleanupErrors.length > 0) {
      throw new Error(`push_mig isolated-schema cleanup failed (possible leak): ${cleanupErrors.join("; ")}`);
    }
  }
}

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
    // --- migration applies to an isolated PRE-migration schema (runs first) ---
    await assertMigrationAppliesToPreMigrationSchema(pool);

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

    // --- platform-columns CHECK rejects each invalid platform/column combination (23514) ---
    // web without the web-push triple
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform) values ($1,$2,$3,'web')`,
          [uid(), clinicId, "u-web-notriple"],
        ),
      "23514",
      "web row without endpoint/p256dh/auth must violate the platform-columns CHECK",
    );
    // web missing p256dh (endpoint + auth present)
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, endpoint, auth) values ($1,$2,$3,'web',$4,'a')`,
          [uid(), clinicId, "u-web-nop256", `https://push.example/${uid()}`],
        ),
      "23514",
      "web row missing p256dh must violate the platform-columns CHECK",
    );
    // web carrying a native token — web rows must have token NULL (columns are
    // mutually exclusive), even with the full web-push triple present
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, endpoint, p256dh, auth, token) values ($1,$2,$3,'web',$4,'p','a',$5)`,
          [uid(), clinicId, "u-web-tok", `https://push.example/${uid()}`, `TOK-${uid()}`],
        ),
      "23514",
      "web row carrying a token must violate the platform-columns CHECK",
    );
    // native (ios) without a token
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform) values ($1,$2,$3,'ios')`,
          [uid(), clinicId, "u-ios-notok"],
        ),
      "23514",
      "ios row without a token must violate the platform-columns CHECK",
    );
    // native (android) carrying a web endpoint — columns must be mutually exclusive
    await expectReject(
      () =>
        pool.query(
          `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token, endpoint) values ($1,$2,$3,'android',$4,$5)`,
          [uid(), clinicId, "u-and-ep", `TOK-${uid()}`, `https://push.example/${uid()}`],
        ),
      "23514",
      "native row carrying a web endpoint must violate the platform-columns CHECK",
    );

    // --- partial UNIQUE(clinic_id, token) rejects a duplicate native token IN THE SAME CLINIC ---
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
      "duplicate native token in the same clinic must violate the partial UNIQUE index",
    );

    await pool.query(`insert into vt_clinics (id) values ($1)`, [otherClinicId]);

    // --- clinic-scoped uniqueness: the SAME native token is allowed in a DIFFERENT clinic ---
    const sharedToken = `SHARED-${uid()}`;
    await pool.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'ios',$4)`,
      [uid(), clinicId, "u-shared-a", sharedToken],
    );
    // identical token, different clinic → accepted (composite (clinic_id, token) unique index)
    await pool.query(
      `insert into vt_push_subscriptions (id, clinic_id, user_id, platform, token) values ($1,$2,$3,'ios',$4)`,
      [uid(), otherClinicId, "u-shared-b", sharedToken],
    );
    const shared = await pool.query(`select clinic_id from vt_push_subscriptions where token=$1`, [sharedToken]);
    assert.strictEqual(shared.rowCount, 2, "identical native token must be allowed across two different clinics");

    // --- multi-tenancy: a clinic-scoped delete must NOT reach another clinic's row ---
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
