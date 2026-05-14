/**
 * Phase 2.5 PR 1 — schema introspection.
 *
 * Verifies the additive schema changes for clinical check-in and operational
 * roles landed correctly in the database:
 *   1. vt_users.allowed_operational_roles  (jsonb NOT NULL DEFAULT '[]'::jsonb)
 *   2. vt_clinical_check_ins table + the three required indexes
 *
 * This is a DB integration test. It MUST skip cleanly when no real database
 * is reachable so the default `pnpm test` run still passes.
 *
 * tests/vitest-setup.ts unconditionally assigns a stub DATABASE_URL when one
 * is not exported, so a literal `!process.env.DATABASE_URL` check is not
 * sufficient. Instead we attempt a single `SELECT 1` probe and skip the whole
 * suite if the probe fails (either because no DB is reachable or because
 * migrations 121/122 have not been applied).
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

describe.skipIf(!dbReachable)("phase-2.5 schema", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = probePool!;
  });

  afterAll(async () => {
    if (probePool) {
      await probePool.end();
    }
  });

  describe("vt_users.allowed_operational_roles", () => {
    it("exists with jsonb type, NOT NULL, default '[]'::jsonb", async () => {
      const { rows } = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'vt_users'
            AND column_name = 'allowed_operational_roles'`,
      );
      expect(rows.length).toBe(1);
      const col = rows[0];
      expect(col.data_type).toBe("jsonb");
      expect(col.is_nullable).toBe("NO");
      expect(col.column_default).not.toBeNull();
      // Postgres normalises the default to "'[]'::jsonb"
      expect(col.column_default!.replace(/\s+/g, "")).toContain("'[]'::jsonb");
    });
  });

  describe("vt_clinical_check_ins", () => {
    it("table exists", async () => {
      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_name = 'vt_clinical_check_ins'`,
      );
      expect(rows.length).toBe(1);
    });

    it("has all required columns with expected nullability/types", async () => {
      const { rows } = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        character_maximum_length: number | null;
      }>(
        `SELECT column_name, data_type, is_nullable, character_maximum_length
           FROM information_schema.columns
          WHERE table_name = 'vt_clinical_check_ins'`,
      );
      const byName = new Map(rows.map((r) => [r.column_name, r] as const));

      const expected: ReadonlyArray<{
        name: string;
        nullable: "NO" | "YES";
        type: string;
        length?: number;
      }> = [
        { name: "id", nullable: "NO", type: "text" },
        { name: "clinic_id", nullable: "NO", type: "text" },
        { name: "user_id", nullable: "NO", type: "text" },
        { name: "checked_in_at", nullable: "NO", type: "timestamp with time zone" },
        { name: "checked_out_at", nullable: "YES", type: "timestamp with time zone" },
        { name: "operational_role", nullable: "YES", type: "character varying", length: 40 },
        { name: "clinical_role_at_check_in", nullable: "NO", type: "character varying", length: 20 },
        { name: "active_shift_id", nullable: "YES", type: "text" },
        { name: "shift_session_id", nullable: "YES", type: "text" },
        { name: "check_out_reason", nullable: "YES", type: "character varying", length: 40 },
        { name: "client_id", nullable: "YES", type: "character varying", length: 64 },
        { name: "created_at", nullable: "NO", type: "timestamp with time zone" },
      ];

      for (const col of expected) {
        const found = byName.get(col.name);
        expect(found, `missing column ${col.name}`).toBeDefined();
        expect(found!.is_nullable, `nullability for ${col.name}`).toBe(col.nullable);
        expect(found!.data_type, `type for ${col.name}`).toBe(col.type);
        if (col.length !== undefined) {
          expect(found!.character_maximum_length, `length for ${col.name}`).toBe(col.length);
        }
      }
    });

    it("has the three required indexes", async () => {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE tablename = 'vt_clinical_check_ins'`,
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef] as const));

      expect(byName.has("ux_vt_clinical_check_ins_open_per_user")).toBe(true);
      expect(byName.has("idx_vt_clinical_check_ins_clinic_open")).toBe(true);
      expect(byName.has("idx_vt_clinical_check_ins_user_recent")).toBe(true);
    });

    it("ux_vt_clinical_check_ins_open_per_user is UNIQUE and partial on checked_out_at IS NULL", async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE tablename = 'vt_clinical_check_ins'
            AND indexname = 'ux_vt_clinical_check_ins_open_per_user'`,
      );
      expect(rows.length).toBe(1);
      const def = rows[0].indexdef;
      expect(def).toMatch(/CREATE UNIQUE INDEX/i);
      expect(def).toMatch(/checked_out_at\s+IS\s+NULL/i);
    });
  });
});
