#!/usr/bin/env node
/**
 * Refuses to let the cross-repo contract suites report green without running.
 *
 * `integration-ops` runs tests/doctor-shift-gate.integration.test.ts and
 * tests/seed-reviewer-demo.integration.test.ts by name (see ci.yml). Both guard
 * themselves with `describe.skipIf(!dbReachable)`, where `dbReachable` comes from
 * probing `SELECT 1` against `process.env.DATABASE_URL`
 * (doctor-shift-gate:46-62, seed-reviewer-demo:20-32). That guard is right on a
 * developer laptop with no database and inverts in CI: an unset or unreachable
 * DATABASE_URL makes both skip, vitest exits 0, and the step reports success
 * having asserted nothing — including the `source: "doctor_gate"` contract the RN
 * app and the TV ward board both consume.
 *
 * Two assertions, in the order a failure actually occurs:
 *
 *  1. DATABASE_URL set and reachable — the literal `skipIf` condition, so a green
 *     preflight means neither suite can skip.
 *  2. `vt_clinical_check_ins` present — migrations 181-184, which doctor-shift-gate
 *     documents as its precondition (`:15`). NOT part of its skip probe, so a
 *     reachable-but-behind database would run the suite and fail deep inside it
 *     with a confusing error instead of here with a clear one.
 *
 * SCOPE, stated so the next reader does not over-trust this:
 * assertion 1 is exactly the two suites' own probe. It is NOT a general guarantee
 * that no vitest suite can silently skip. tests/equipment-operational-state
 * (run by `test:integration:ops`, not here) probes further — it requires
 * `vt_equipment.custody_state` and skips 49 tests without it. If that file is ever
 * added to this step, add its probe here too, or this guard will pass while it
 * skips. The durable fix for that whole class is to assert vitest's own reported
 * skip count after the run rather than hand-copying probe conditions; that is a
 * follow-up, not this script.
 */

/** Pure: the DATABASE_URL branch. Kept separate so it is testable without a database. */
export function evaluateDatabaseUrl(databaseUrl) {
  if (!databaseUrl || !databaseUrl.trim()) {
    return {
      ok: false,
      message:
        "DATABASE_URL is unset. Both contract suites would skipIf and the step would " +
        "report green having run nothing. Refusing.",
    };
  }
  return { ok: true, message: "" };
}

/** Pure: the schema branch. `rowCount` is the count of matching information_schema rows. */
export function evaluateSchema(rowCount) {
  if (rowCount !== 1) {
    return {
      ok: false,
      message:
        "DATABASE_URL is reachable but `vt_clinical_check_ins` is missing — migrations " +
        "181-184 are not applied. doctor-shift-gate would run against a schema it does " +
        "not support and fail deep inside the suite. Refusing here instead.",
    };
  }
  return { ok: true, message: "" };
}

// Self-execute only when run as a script, so the tests can import the predicates.
// import.meta.main is not available on this Node line; compare argv[1] instead.
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const urlVerdict = evaluateDatabaseUrl(process.env.DATABASE_URL);
  if (!urlVerdict.ok) {
    console.error(`❌ ${urlVerdict.message}`);
    process.exit(1); // nothing opened yet — no cleanup owed
  }

  // Imported AFTER the env check so the unset branch stays runnable (and testable)
  // without node_modules present.
  const { Pool } = await import("pg");

  // connectionTimeoutMillis matches the suites' own probe (2000ms) so this check
  // cannot pass on a database slow enough that the suites then skip.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    max: 2,
  });

  try {
    await pool.query("SELECT 1");
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'vt_clinical_check_ins'`,
    );
    const schemaVerdict = evaluateSchema(rows.length);
    if (!schemaVerdict.ok) {
      console.error(`❌ ${schemaVerdict.message}`);
      process.exitCode = 1;
    } else {
      console.log("✅ DATABASE_URL reachable and migrated — the contract suites will execute, not skip.");
    }
  } catch (err) {
    console.error(
      "❌ DATABASE_URL is set but unreachable. Both contract suites would skipIf and the " +
        "step would report green having run nothing. Refusing.",
    );
    console.error(err);
    // exitCode, not exit(1): process.exit() terminates before the awaited `finally`
    // runs, so the pool would never close.
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
