/**
 * Tenant-context pooling invariants (G7 / row-level security groundwork).
 *
 * RLS keyed on a GUC (`current_setting('app.clinic_id')`) is only as strong as the
 * connection-lifetime guarantees underneath it. These tests assert the pooling
 * invariants that MUST hold before any GUC-based policy can be trusted.
 *
 * They run against a real Postgres and a real `pg.Pool` + Drizzle — no mocked
 * boundary — using a dedicated probe table. They never touch a `vt_` table.
 *
 * Skipped unless a real DATABASE_URL is supplied, so the default `pnpm test` run
 * stays green. `tests/vitest-setup.ts` injects a placeholder URL when none is set,
 * so presence alone is not enough — the placeholder is treated as "no database".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

/** Injected by tests/vitest-setup.ts purely so server modules can import cleanly. */
const PLACEHOLDER_DB_URL = "postgres://vettrack:vettrack@127.0.0.1:5432/vettrack_test";

const DB_URL = process.env.DATABASE_URL;
const PROBE = "zz_tenant_pooling_probe";
const suite = DB_URL && DB_URL !== PLACEHOLDER_DB_URL ? describe : describe.skip;

suite("tenant context cannot outlive its transaction on a pooled connection", () => {
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

  it("does not hand a tenant GUC to the next checkout of the same pooled connection", async () => {
    const pool = new Pool({ connectionString: DB_URL, max: 1 });
    try {
      const a = await pool.connect();
      await a.query(`SET app.clinic_id = 'clinic-A'`);
      a.release(); // what a request handler does when it finishes

      const b = await pool.connect(); // the NEXT request
      const seen = (await b.query(`SELECT current_setting('app.clinic_id', true) AS g`)).rows[0].g;
      b.release();

      expect(seen, "tenant GUC leaked across pool checkouts").toBeFalsy();
    } finally {
      await pool.end();
    }
  });

  it("pins a request's statements to one session instead of one checkout each", async () => {
    // Establishes that the leak below is not an artefact of a single-connection
    // pool: with drizzle(pool), concurrent statements land on DIFFERENT backends,
    // so a request's SET and its later SELECT are not guaranteed to share a session.
    const pool = new Pool({ connectionString: DB_URL, max: 2 });
    const db = drizzle(pool);
    try {
      const [r1, r2]: any[] = await Promise.all([
        db.execute(sql`SELECT pg_backend_pid() AS p`),
        db.execute(sql`SELECT pg_backend_pid() AS p`),
      ]);
      const pid1 = (r1.rows ?? r1)[0].p;
      const pid2 = (r2.rows ?? r2)[0].p;
      expect(pid1, `concurrent statements ran on separate backends ${pid1}/${pid2}`).toBe(pid2);
    } finally {
      await pool.end();
    }
  });

  it("never executes a request's query under another tenant's context", async () => {
    const pool = new Pool({ connectionString: DB_URL, max: 1 });
    const db = drizzle(pool);
    try {
      // Two concurrent requests establish context; each drizzle statement is its
      // own pool checkout, so they land on the same pooled connection in turn.
      await db.execute(sql`SET app.clinic_id = 'clinic-A'`); // request A
      await db.execute(sql`SET app.clinic_id = 'clinic-B'`); // request B

      // Request A now runs its query, believing it is scoped to clinic-A.
      const res: any = await db.execute(sql`SELECT clinic_id, secret FROM ${sql.identifier(PROBE)} ORDER BY id`);
      const rows = res.rows ?? res;
      const foreign = rows.filter((r: any) => r.clinic_id !== "clinic-A");

      expect(foreign, `request A received another clinic's rows: ${JSON.stringify(foreign)}`).toHaveLength(0);
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
      const rows: any = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.clinic_id = 'clinic-A'`);
        const r: any = await tx.execute(sql`SELECT clinic_id, secret FROM ${sql.identifier(PROBE)} ORDER BY id`);
        return r.rows ?? r;
      });
      expect(rows.filter((r: any) => r.clinic_id !== "clinic-A")).toHaveLength(0);
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
