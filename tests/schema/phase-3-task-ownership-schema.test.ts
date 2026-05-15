/**
 * Phase 3 PR 3.1 — schema introspection.
 *
 * Verifies the additive schema foundation for typed task ownership on
 * vt_appointments:
 *   1. acknowledged_user_id  (text, nullable, FK -> vt_users(id) ON DELETE SET NULL)
 *   2. acknowledged_at       (timestamptz, nullable)
 *   3. idx_vt_appointments_clinic_acked_user_status (partial index on
 *      acknowledged_user_id IS NOT NULL, over (clinic_id, acknowledged_user_id, status))
 *
 * This is foundation-only. No reads, writes, or behavior depend on these
 * columns yet. The existing metadata.acknowledgedBy string remains
 * authoritative until later PRs.
 *
 * This is a DB integration test. It MUST skip cleanly when no real database
 * is reachable so the default `pnpm test` run still passes. We mirror the
 * probe-then-skipIf pattern from tests/schema/phase-25-schema.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 1500,
    max: 1,
  });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}

describe.skipIf(!dbReachable)("phase-3 pr 3.1 schema", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = probePool!;
  });

  afterAll(async () => {
    if (probePool) {
      await probePool.end();
    }
  });

  describe("vt_appointments.acknowledged_user_id", () => {
    it("exists with text type and is nullable", async () => {
      const { rows } = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'vt_appointments'
            AND column_name = 'acknowledged_user_id'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].data_type).toBe("text");
      expect(rows[0].is_nullable).toBe("YES");
    });

    it("has FK to vt_users(id) with ON DELETE SET NULL", async () => {
      const { rows } = await pool.query<{
        constraint_name: string;
        delete_rule: string;
        foreign_table: string;
        foreign_column: string;
      }>(
        `SELECT
            tc.constraint_name,
            rc.delete_rule,
            ccu.table_name  AS foreign_table,
            ccu.column_name AS foreign_column
           FROM information_schema.table_constraints AS tc
           JOIN information_schema.key_column_usage AS kcu
             ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.referential_constraints AS rc
             ON tc.constraint_name = rc.constraint_name
           JOIN information_schema.constraint_column_usage AS ccu
             ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = 'vt_appointments'
            AND kcu.column_name = 'acknowledged_user_id'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].foreign_table).toBe("vt_users");
      expect(rows[0].foreign_column).toBe("id");
      expect(rows[0].delete_rule).toBe("SET NULL");
    });
  });

  describe("vt_appointments.acknowledged_at", () => {
    it("exists with timestamptz type and is nullable", async () => {
      const { rows } = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'vt_appointments'
            AND column_name = 'acknowledged_at'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].data_type).toBe("timestamp with time zone");
      expect(rows[0].is_nullable).toBe("YES");
    });
  });

  describe("idx_vt_appointments_clinic_acked_user_status", () => {
    it("exists as a partial index on acknowledged_user_id IS NOT NULL", async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE tablename = 'vt_appointments'
            AND indexname = 'idx_vt_appointments_clinic_acked_user_status'`,
      );
      expect(rows.length).toBe(1);
      const def = rows[0].indexdef;
      expect(def).toMatch(/CREATE INDEX/i);
      expect(def).toMatch(/clinic_id/);
      expect(def).toMatch(/acknowledged_user_id/);
      expect(def).toMatch(/status/);
      expect(def).toMatch(/acknowledged_user_id\s+IS\s+NOT\s+NULL/i);
    });
  });

  describe("backward compatibility", () => {
    it("does not introduce a NOT NULL constraint on acknowledged_user_id (compat window)", async () => {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable
           FROM information_schema.columns
          WHERE table_name = 'vt_appointments'
            AND column_name = 'acknowledged_user_id'`,
      );
      expect(rows[0]?.is_nullable).toBe("YES");
    });

    it("does not introduce a NOT NULL constraint on acknowledged_at (compat window)", async () => {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable
           FROM information_schema.columns
          WHERE table_name = 'vt_appointments'
            AND column_name = 'acknowledged_at'`,
      );
      expect(rows[0]?.is_nullable).toBe("YES");
    });
  });
});
