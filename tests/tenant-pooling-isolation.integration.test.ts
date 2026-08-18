/**
 * Tenant-context pooling BREAKAGE PROBES (G7 / row-level-security groundwork).
 *
 * RLS keyed on a GUC (`current_setting('app.clinic_id')`) is only as strong as
 * the connection-lifetime guarantees underneath it. These cases pin what
 * Postgres and `pg.Pool` actually DO — which is the opposite of what a naive
 * `SET`-per-request would assume — so the CONTROL at the bottom shows the only
 * pattern a GUC-based policy may be built on.
 *
 * STATUS, stated because it changes what this file is worth: **these probes
 * have never been executed.** They require a dedicated throwaway database that
 * does not exist in this environment, and the local role lacks CREATEDB. They
 * encode documented Postgres semantics, not observed ones. Do not cite them as
 * evidence until the run below has actually happened.
 *
 * They are DDL — CREATE TABLE, ENABLE and FORCE ROW LEVEL SECURITY, CREATE
 * POLICY — so a non-placeholder `DATABASE_URL` is deliberately NOT enough to
 * arm them: a developer with staging configured would otherwise create and drop
 * a table there. Both of these are required:
 *
 *   RLS_POOLING_PROBE=1 \
 *   RLS_PROBE_DATABASE_URL=postgres://.../a_throwaway_db \
 *   pnpm test:rls-pooling
 *
 * `RLS_PROBE_DATABASE_URL` is read INSTEAD of `DATABASE_URL`, never as a
 * fallback to it, so the application database cannot be reached by omission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

/**
 * Two independent locks, both required. `DATABASE_URL` is never consulted: the
 * point is that the application database must be unreachable from here even by
 * accident, so there is no fallback to fall back to.
 */
const ARMED = process.env.RLS_POOLING_PROBE === "1";
const DB_URL = process.env.RLS_PROBE_DATABASE_URL;
const PROBE = "zz_tenant_pooling_probe";
const suite = ARMED && DB_URL ? describe : describe.skip;

type GucRow = { g: string | null };
type PidRow = { p: number };
type ProbeRow = { clinic_id: string; secret: string };

suite("what a pooled connection actually does to a session-scoped tenant GUC", () => {
  beforeAll(async () => {
    const p = new Pool({ connectionString: DB_URL, max: 1 });
    await p.query(`DROP TABLE IF EXISTS ${PROBE}`);
    await p.query(`CREATE TABLE ${PROBE} (id serial primary key, clinic_id text not null, secret text not null)`);
    await p.query(`INSERT INTO ${PROBE} (clinic_id, secret) VALUES
      ('clinic-A','A-private'),('clinic-B','B-PRIVATE-PHI')`);
    // A CORRECTLY built policy: ENABLE + FORCE (the app role owns its tables) + GUC predicate.
    await p.query(`ALTER TABLE ${PROBE} ENABLE ROW LEVEL SECURITY`);
    await p.query(`ALTER TABLE ${PROBE} FORCE ROW LEVEL SECURITY`);
    await p.query(`CREATE POLICY tenant_isolation ON ${PROBE}
      USING (clinic_id = current_setting('app.clinic_id', true))`);
    await p.end();
  });

  afterAll(async () => {
    const p = new Pool({ connectionString: DB_URL, max: 1 });
    await p.query(`DROP TABLE IF EXISTS ${PROBE}`);
    await p.end();
  });

  it("PROBE: a session-scoped GUC survives release and reaches the next checkout", async () => {
    // `SET` (not `SET LOCAL`) lives for the SESSION, and pg-pool does not issue
    // DISCARD ALL when a client is released. So the next request checking out
    // the same backend inherits the previous request's tenant. This is the
    // hazard the CONTROL below exists to avoid — asserted as what it is.
    const pool = new Pool({ connectionString: DB_URL, max: 1 });
    try {
      const a = await pool.connect();
      await a.query(`SET app.clinic_id = 'clinic-A'`);
      a.release(); // what a request handler does when it finishes

      const b = await pool.connect(); // the NEXT request
      const seen = (await b.query<GucRow>(`SELECT current_setting('app.clinic_id', true) AS g`)).rows[0].g;
      b.release();

      expect(seen, "a session GUC did NOT survive the checkout — re-derive this probe").toBe("clinic-A");
    } finally {
      await pool.end();
    }
  });

  it("PROBE: concurrent statements on drizzle(pool) land on DIFFERENT backends", async () => {
    // Each drizzle statement is its own checkout. With room in the pool, two
    // concurrent statements get two backends — so a request's `SET` and its
    // later `SELECT` are not guaranteed to share a session at all. That is why
    // per-request `SET` cannot be the mechanism, independent of the leak above.
    const pool = new Pool({ connectionString: DB_URL, max: 2 });
    const db = drizzle(pool);
    try {
      const [r1, r2] = await Promise.all([
        db.execute<PidRow>(sql`SELECT pg_backend_pid() AS p`),
        db.execute<PidRow>(sql`SELECT pg_backend_pid() AS p`),
      ]);
      expect(r1.rows[0].p, "concurrent statements shared one backend — pool sizing changed").not.toBe(r2.rows[0].p);
    } finally {
      await pool.end();
    }
  });

  it("PROBE: the last SET wins, so a request runs under another tenant's context", async () => {
    const pool = new Pool({ connectionString: DB_URL, max: 1 });
    const db = drizzle(pool);
    try {
      // Two requests establish context on one pooled connection; each drizzle
      // statement is its own checkout, so the LAST `SET` wins for both.
      await db.execute(sql`SET app.clinic_id = 'clinic-A'`); // request A
      await db.execute(sql`SET app.clinic_id = 'clinic-B'`); // request B

      // Request A now runs its query, believing it is scoped to clinic-A.
      const res = await db.execute<ProbeRow>(sql`SELECT clinic_id, secret FROM ${sql.identifier(PROBE)} ORDER BY id`);
      const seen = res.rows.map((r) => r.clinic_id);

      // It is served clinic-B's row. Under a policy keyed on this GUC, that is
      // a cross-tenant read with no application-layer mistake anywhere.
      expect(seen, "request A was NOT served the other tenant — re-derive this probe").toEqual(["clinic-B"]);
    } finally {
      await pool.end();
    }
  });

  // Positive control: proves the harness can distinguish a correct setup from a
  // broken one. If this fails, the two tests above are not trustworthy evidence.
  it("CONTROL: SET LOCAL inside a transaction isolates correctly", async () => {
    const pool = new Pool({ connectionString: DB_URL, max: 1 });
    const db = drizzle(pool);
    try {
      await db.execute(sql`SET app.clinic_id = 'clinic-B'`); // poison the pooled connection
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.clinic_id = 'clinic-A'`);
        const r = await tx.execute<ProbeRow>(sql`SELECT clinic_id, secret FROM ${sql.identifier(PROBE)} ORDER BY id`);
        return r.rows;
      });
      expect(rows.filter((r) => r.clinic_id !== "clinic-A")).toHaveLength(0);
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
