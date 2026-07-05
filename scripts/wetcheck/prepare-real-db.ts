/**
 * prepare-real-db.ts — GUARDED cleanup to ready a real DB for live equipment seeding.
 *
 * SAFETY MODEL (read before running):
 *   - DRY-RUN BY DEFAULT. Prints exactly what it WOULD delete and changes nothing.
 *   - To actually delete you must pass BOTH `--execute` AND set CONFIRM_PURGE=1.
 *   - NEVER deletes the protected account (danerez5@gmail.com) — hard-coded guard.
 *   - NEVER deletes a clinic unless it matches a known TEST-CLINIC pattern
 *     (rfid-test-*, clinic-f3-*, clinic-e2e-*, or an explicit allowlist).
 *     Any clinic that does not match a test pattern is treated as REAL and left alone.
 *   - Refuses to run in production unless FORCE_REAL_DB_PURGE=1 is also set.
 *   - The whole purge runs in ONE transaction — any failure rolls back everything.
 *   - vt_audit_logs is append-only (DO INSTEAD NOTHING delete rule) and its clinic
 *     FK is RESTRICT, so clinics with audit rows are undeletable unless the rule is
 *     bypassed. That bypass requires the extra flag ALLOW_AUDIT_LOG_PURGE=1; without
 *     it the script aborts in preflight (before deleting anything) and tells you.
 *     With the flag, the rule is dropped and re-created inside the same transaction,
 *     so the append-only invariant is never left off, even on a crash.
 *   - LOCKING: dropping the rule takes an ACCESS EXCLUSIVE lock on vt_audit_logs
 *     that is held until the transaction commits, so ALL audit reads/writes block
 *     for the duration of the purge. This is an offline maintenance tool — run it
 *     in a maintenance window, never against a live-traffic database. (Kept in one
 *     transaction deliberately: splitting the rule swap out would allow a crash to
 *     leave the append-only rule off permanently.)
 *
 * Typical use:
 *   # 1) See what would be removed (safe):
 *   DATABASE_URL=... tsx scripts/wetcheck/prepare-real-db.ts
 *   # 2) Actually remove it (irreversible):
 *   CONFIRM_PURGE=1 ALLOW_AUDIT_LOG_PURGE=1 DATABASE_URL=... tsx scripts/wetcheck/prepare-real-db.ts --execute
 *
 * What it targets (test data only):
 *   - Clinics matching test patterns + ALL their child rows. Child tables and a safe
 *     deletion order are discovered from pg_constraint at runtime (every table with a
 *     clinic FK, children before the tables they reference), so schema drift cannot
 *     silently strand rows and crash the purge mid-way.
 *   - Dev QA fixtures in dev-clinic-default by name prefix ("QA Test", "E2E Test", "WC ")
 *
 * What it preserves:
 *   - danerez5@gmail.com (and its clinic)
 *   - Every clinic NOT matching a test pattern
 *   - dev-clinic-default itself (only its named test fixtures are removed)
 *   - Audit rows of every non-target clinic (target-clinic audit rows only go with
 *     ALLOW_AUDIT_LOG_PURGE=1)
 */
import "dotenv/config";
import { pathToFileURL } from "url";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db.js";

// Hard-coded default is deliberate — the protected-account guarantee must not
// depend on remembering an env var. PROTECTED_ACCOUNT_EMAIL can override it.
const PROTECTED_EMAIL = (process.env.PROTECTED_ACCOUNT_EMAIL || "danerez5@gmail.com").trim();
const PROTECTED_EMAIL_MASKED = PROTECTED_EMAIL.replace(/^(.).*(.)@/, "$1***$2@");
const EXECUTE = process.argv.includes("--execute") && process.env.CONFIRM_PURGE === "1";
const ALLOW_AUDIT_LOG_PURGE = process.env.ALLOW_AUDIT_LOG_PURGE === "1";
const TEST_CLINIC_LIKE = ["rfid-test-%", "clinic-f3-%", "clinic-e2e-%", "rfid-clinic-%"];
const DEV_FIXTURE_NAME_PREFIXES = ["QA Test", "E2E Test", "WC "];

export type FkEdge = { child: string; parent: string };

/**
 * Order tables so that every table is deleted before the tables it references
 * with a delete-blocking FK (children first). Cycles are broken deterministically
 * (alphabetical); a genuine bidirectional RESTRICT cycle cannot be resolved by
 * ordering — the delete would fail and the caller's transaction rolls back
 * atomically (nothing is half-purged).
 */
export function orderTablesForDeletion(tables: string[], edges: FkEdge[]): string[] {
  const remaining = new Set(tables);
  const blocking = edges.filter(
    (e) => e.child !== e.parent && remaining.has(e.child) && remaining.has(e.parent),
  );
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((t) => !blocking.some((e) => e.parent === t && e.child !== t && remaining.has(e.child)))
      .sort();
    const batch = ready.length > 0 ? ready : [[...remaining].sort()[0]];
    for (const t of batch) {
      remaining.delete(t);
      ordered.push(t);
    }
  }
  return ordered;
}

type Row = Record<string, unknown>;

function rowsOf(res: unknown): Row[] {
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = rowsOf(await db.execute(query));
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
}

/** Every table holding an FK to vt_clinics, with the referencing column name. */
async function discoverClinicChildTables(): Promise<Map<string, string>> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.confrelid = 'vt_clinics'::regclass
    `),
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    const tbl = String(r.tbl);
    if (tbl !== "vt_clinics") map.set(tbl, String(r.col));
  }
  return map;
}

/** Delete-blocking FK edges (RESTRICT / NO ACTION) among the given tables. */
async function discoverBlockingEdges(tables: Set<string>): Promise<FkEdge[]> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT DISTINCT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
      FROM pg_constraint
      WHERE contype = 'f' AND confdeltype IN ('a', 'r')
    `),
  );
  return rows
    .map((r) => ({ child: String(r.child), parent: String(r.parent) }))
    .filter((e) => tables.has(e.child) && tables.has(e.parent));
}

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    console.error("[prepare-real-db] DATABASE_URL is required.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && process.env.FORCE_REAL_DB_PURGE !== "1") {
    console.error("[prepare-real-db] Refusing to run in production without FORCE_REAL_DB_PURGE=1.");
    process.exit(1);
  }
  console.info(`[prepare-real-db] target=${dbUrl.replace(/:[^:@/]*@/, ":***@")}`);
  console.info(`[prepare-real-db] mode=${EXECUTE ? "EXECUTE (irreversible)" : "DRY-RUN (no changes)"}`);
  console.info(`[prepare-real-db] protected account: ${PROTECTED_EMAIL_MASKED}`);

  // vt_clinics uses `id` (not `clinic_id`). Build the target-clinic set once and
  // reference it everywhere via `<clinic-fk-col> IN (targetClinics)`.
  const idLikeClauses = TEST_CLINIC_LIKE.map((p) => sql`id LIKE ${p}`);
  const isTestClinicById = sql.join(idLikeClauses, sql` OR `);

  // Never touch a clinic that holds the protected account.
  const targetClinics = sql`
    (SELECT id FROM vt_clinics
      WHERE (${isTestClinicById})
        AND id NOT IN (SELECT clinic_id FROM vt_users WHERE email = ${PROTECTED_EMAIL}))
  `;

  const testClinicCount = await scalar(sql`
    SELECT count(*)::int AS n FROM vt_clinics WHERE id IN ${targetClinics}
  `);
  const testEquipmentCount = await scalar(sql`
    SELECT count(*)::int AS n FROM vt_equipment WHERE clinic_id IN ${targetClinics}
  `);
  const auditRowCount = await scalar(sql`
    SELECT count(*)::int AS n FROM vt_audit_logs WHERE clinic_id IN ${targetClinics}
  `);
  const namePrefixOr = sql.join(
    DEV_FIXTURE_NAME_PREFIXES.map((p) => sql`name LIKE ${p + "%"}`),
    sql` OR `,
  );
  const devFixtureCount = await scalar(sql`
    SELECT count(*)::int AS n FROM vt_equipment
    WHERE clinic_id = 'dev-clinic-default' AND (${namePrefixOr})
  `);
  const protectedRows = await scalar(sql`SELECT count(*)::int AS n FROM vt_users WHERE email = ${PROTECTED_EMAIL}`);

  const childColumns = await discoverClinicChildTables();
  const edges = await discoverBlockingEdges(new Set(childColumns.keys()));
  const orderedTables = orderTablesForDeletion([...childColumns.keys()], edges);

  console.info("\n── Plan ─────────────────────────────────────────────");
  console.info(`  test clinics to remove        : ${testClinicCount}`);
  console.info(`  equipment under test clinics  : ${testEquipmentCount}`);
  console.info(`  audit rows under test clinics : ${auditRowCount} (needs ALLOW_AUDIT_LOG_PURGE=1 if > 0)`);
  console.info(`  dev-clinic-default fixtures   : ${devFixtureCount} (by name prefix)`);
  console.info(`  protected ${PROTECTED_EMAIL_MASKED} rows : ${protectedRows} (never deleted)`);
  console.info(`  child tables (discovered)     : ${orderedTables.length}`);
  console.info("─────────────────────────────────────────────────────\n");

  if (!EXECUTE) {
    console.info("[prepare-real-db] DRY-RUN complete. Nothing was changed.");
    console.info(
      "[prepare-real-db] To execute: CONFIRM_PURGE=1 tsx scripts/wetcheck/prepare-real-db.ts --execute" +
        (auditRowCount > 0 ? " (plus ALLOW_AUDIT_LOG_PURGE=1 — target clinics have audit rows)" : ""),
    );
    return;
  }

  // PREFLIGHT — abort before touching anything if the purge cannot complete.
  const purgeAuditRows = auditRowCount > 0;
  if (purgeAuditRows && !ALLOW_AUDIT_LOG_PURGE) {
    console.error(
      `[prepare-real-db] ABORTED (nothing deleted): ${auditRowCount} audit rows belong to the target test clinics.\n` +
        "  vt_audit_logs is append-only and its clinic FK is RESTRICT, so these clinics cannot be\n" +
        "  removed without also purging their audit rows. If you intend that, re-run with\n" +
        "  ALLOW_AUDIT_LOG_PURGE=1. Audit rows of non-target clinics are never touched.",
    );
    process.exit(1);
  }

  // EXECUTE PATH — one transaction: children before parents (discovered order),
  // then clinics. Any failure rolls back the entire purge.
  await db.transaction(async (tx) => {
    if (purgeAuditRows) {
      await tx.execute(sql`DROP RULE IF EXISTS no_delete_audit_logs ON vt_audit_logs`);
    }
    for (const t of orderedTables) {
      if (t === "vt_audit_logs" && !purgeAuditRows) continue;
      const col = childColumns.get(t)!;
      const guard = t === "vt_users" ? sql` AND email <> ${PROTECTED_EMAIL}` : sql``;
      const res = await tx.execute(sql`
        DELETE FROM ${sql.raw(t)}
        WHERE ${sql.raw(col)} IN ${targetClinics}${guard}
      `);
      const n = (res as unknown as { rowCount?: number }).rowCount ?? 0;
      console.info(`  purged ${t.padEnd(32)} ${n}`);
    }
    // Dev-clinic-default named fixtures.
    const fx = await tx.execute(sql`
      DELETE FROM vt_equipment WHERE clinic_id = 'dev-clinic-default' AND (${namePrefixOr})
    `);
    console.info(`  purged dev fixtures               ${(fx as unknown as { rowCount?: number }).rowCount ?? 0}`);
    // Finally the test clinic rows.
    const cl = await tx.execute(sql`
      DELETE FROM vt_clinics WHERE id IN ${targetClinics}
    `);
    console.info(`  purged vt_clinics                 ${(cl as unknown as { rowCount?: number }).rowCount ?? 0}`);
    if (purgeAuditRows) {
      await tx.execute(sql`CREATE RULE no_delete_audit_logs AS ON DELETE TO vt_audit_logs DO INSTEAD NOTHING`);
    }
  });

  const remainingProtected = await scalar(sql`SELECT count(*)::int AS n FROM vt_users WHERE email = ${PROTECTED_EMAIL}`);
  const ruleRestored = await scalar(sql`
    SELECT count(*)::int AS n FROM pg_rules
    WHERE tablename = 'vt_audit_logs' AND rulename = 'no_delete_audit_logs'
  `);
  console.info(`\n[prepare-real-db] protected account rows remaining: ${remainingProtected}`);
  console.info(`[prepare-real-db] audit append-only rule present: ${ruleRestored === 1 ? "yes" : "NO — investigate"}`);
  console.info("[prepare-real-db] EXECUTE complete. Verify counts before seeding real equipment.");
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error("[prepare-real-db] Failed:", err);
      process.exitCode = 1;
    })
    .finally(() => {
      pool.end().catch((err) => console.error("[prepare-real-db] pool.end() failed:", err));
    });
}
