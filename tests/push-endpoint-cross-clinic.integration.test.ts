/**
 * Web-push `endpoint` cross-clinic regression (issue #226).
 *
 * `endpoint` has been globally UNIQUE since 003_add_push_subscriptions.sql.
 * Migration 180 (ADR-009) dropped only its NOT NULL — never the uniqueness —
 * when it extended the table to native tokens, and gave native `token` its own
 * per-clinic partial index (`ux_vt_push_subscriptions_clinic_token`) on the
 * documented reasoning that "ownership is per-tenant, so the same physical
 * device token can register in two clinics". `endpoint` never got the same
 * treatment: server/routes/push.ts's web-subscribe handler deletes-then-inserts
 * scoped to `(clinicId, endpoint)` — written for a per-clinic model the schema
 * never actually enforced — so the SAME browser subscribing under a second
 * clinic collides on `vt_push_subscriptions_endpoint_key` and the insert throws
 * a real unique-violation, caught generically into a 500 `PUSH_SUBSCRIBE_SAVE_FAILED`.
 *
 * Migration 187 closes that gap the same way 180 closed it for `token`: drop the
 * global constraint, add `ux_vt_push_subscriptions_clinic_endpoint` scoped to
 * `(clinic_id, endpoint)`.
 *
 * This is a DB-integration test, not a mocked route test, deliberately: the
 * defect lives entirely in a real Postgres unique index, which a mocked
 * `db.transaction` (see tests/push-token-reassignment.test.ts) cannot exercise
 * either way — such a mock would pass identically before and after the fix.
 * Real constraint behavior needs a real database.
 *
 * Run: DATABASE_URL=... pnpm exec vitest run --config vitest.db-integration.config.ts \
 *        tests/push-endpoint-cross-clinic.integration.test.ts
 * Also wired into `pnpm test:integration:ops` (vitest.integration.ops.config.ts).
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
  } catch {
    // Genuinely unavailable (no DATABASE_URL wired, or nothing listening) — the
    // one case describe.skipIf should silently skip for, same as a developer
    // laptop with no Postgres running.
    dbReachable = false;
  }

  if (dbReachable) {
    // Deliberately NOT a migration-187 marker — the whole point is to run this
    // suite against the table's stable, pre-187 shape too, so it can prove the
    // RED state (a real unique-violation) on an unpatched schema, not just skip
    // past it. clinic_id/endpoint have existed since migrations 003 and 180.
    //
    // A reachable database with a STALE schema is a different failure than an
    // unreachable one and must not silently skip the same way: skipIf would
    // report 0 assertions as a pass, so `pnpm test:integration:ops` could go
    // green having never touched migration 187 at all. Throwing here (module
    // load, before any describe/it runs) fails the whole file loudly instead.
    const { rows } = await probePool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'vt_push_subscriptions' AND column_name IN ('clinic_id', 'endpoint')`,
    );
    if (rows.length !== 2) {
      throw new Error(
        "DATABASE_URL is reachable but vt_push_subscriptions is missing clinic_id and/or " +
          "endpoint (migrations 003/180 not applied) — refusing to silently skip this suite. " +
          "Run `pnpm migrate` against this database and re-run.",
      );
    }
  }
}

/**
 * Centralizes the nullable-pool access every helper/test needs. Throws a
 * contextual error instead of a bare `probePool!` non-null assertion — the
 * invariant (non-null whenever the describe block actually runs) is real, but
 * a plain `!` degrades to a generic "Cannot read properties of null" if it's
 * ever violated, one layer removed from where the real cause is.
 */
function requireProbePool(): Pool {
  if (!probePool) {
    throw new Error(
      "probePool is null — this test should have been skipped by describe.skipIf(!dbReachable). " +
        "requireProbePool() was called outside that gate.",
    );
  }
  return probePool;
}

async function insertSubscription(clinicId: string, endpoint: string, userId = randomUUID()) {
  await requireProbePool().query(
    `INSERT INTO vt_push_subscriptions (id, clinic_id, user_id, platform, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, 'web', $4, 'p256dh-placeholder', 'auth-placeholder')`,
    [randomUUID(), clinicId, userId, endpoint],
  );
}

/** Mirrors server/routes/push.ts's POST /subscribe web-path delete-then-insert exactly. */
async function subscribeLikeRoute(clinicId: string, endpoint: string, userId = randomUUID()) {
  const pool = requireProbePool();
  await pool.query(`DELETE FROM vt_push_subscriptions WHERE clinic_id = $1 AND endpoint = $2`, [
    clinicId,
    endpoint,
  ]);
  await pool.query(
    `INSERT INTO vt_push_subscriptions (id, clinic_id, user_id, platform, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, 'web', $4, 'p256dh-placeholder', 'auth-placeholder')`,
    [randomUUID(), clinicId, userId, endpoint],
  );
}

// Module scope, NOT inside the describe block below: describe.skipIf(!dbReachable)
// skips its own afterAll along with everything else, so a probePool that was
// successfully constructed (DATABASE_URL set, connection reachable) but then
// failed the schema-marker check — reachable database, wrong/behind schema —
// would leak its open connections for the lifetime of the test process. This
// runs regardless of whether the suite below executed or skipped.
afterAll(async () => {
  if (probePool) await probePool.end();
});

describe.skipIf(!dbReachable)("vt_push_subscriptions.endpoint — cross-clinic scope (#226)", () => {
  let clinicA: string;
  let clinicB: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for integration tests");
  });

  afterEach(async () => {
    const pool = requireProbePool();
    if (clinicA) {
      await pool.query(`DELETE FROM vt_push_subscriptions WHERE clinic_id = $1`, [clinicA]);
      await pool.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicA]);
    }
    if (clinicB) {
      await pool.query(`DELETE FROM vt_push_subscriptions WHERE clinic_id = $1`, [clinicB]);
      await pool.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicB]);
    }
  });

  async function makeClinicPair() {
    clinicA = `zz-push-a-${randomUUID()}`;
    clinicB = `zz-push-b-${randomUUID()}`;
    await requireProbePool().query(`INSERT INTO vt_clinics (id) VALUES ($1), ($2)`, [clinicA, clinicB]);
  }

  it("lets the same physical endpoint hold independent subscriptions in two clinics", async () => {
    await makeClinicPair();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

    await insertSubscription(clinicA, endpoint);
    // Before migration 187 this throws: vt_push_subscriptions_endpoint_key is a
    // GLOBAL unique constraint, so clinic B's row collides with clinic A's.
    await expect(insertSubscription(clinicB, endpoint)).resolves.not.toThrow();

    const { rows } = await requireProbePool().query<{ clinic_id: string }>(
      `SELECT clinic_id FROM vt_push_subscriptions WHERE endpoint = $1 ORDER BY clinic_id`,
      [endpoint],
    );
    expect(rows.map((r) => r.clinic_id).sort()).toEqual([clinicA, clinicB].sort());
  });

  it("still refuses two simultaneous rows for the SAME clinic and endpoint", async () => {
    await makeClinicPair();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

    await insertSubscription(clinicA, endpoint);
    // Per-clinic scoping is a real unique index, not open season — a second row
    // for the identical (clinic_id, endpoint) pair must still be rejected.
    await expect(insertSubscription(clinicA, endpoint)).rejects.toThrow(/unique/i);
  });

  it("the route's delete-then-insert still replaces a same-clinic re-subscription with exactly one row", async () => {
    await makeClinicPair();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

    await subscribeLikeRoute(clinicA, endpoint, "user-1");
    await subscribeLikeRoute(clinicA, endpoint, "user-2");

    const { rows } = await requireProbePool().query<{ user_id: string }>(
      `SELECT user_id FROM vt_push_subscriptions WHERE clinic_id = $1 AND endpoint = $2`,
      [clinicA, endpoint],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("user-2");
  });
});
