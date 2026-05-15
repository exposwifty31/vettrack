/**
 * Phase 3 PR 3.2 — schema introspection.
 *
 * Verifies the additive schema for the manual-confirm queue table:
 *   1. table vt_task_ownership_confirm_queue exists with the expected columns
 *   2. ON DELETE behavior on FKs matches the spec
 *   3. UNIQUE (clinic_id, appointment_id, raw_acknowledged_by)
 *   4. partial index on (clinic_id, created_at) WHERE resolved_source = 'pending'
 *   5. (appointment_id) index for reverse lookups
 *
 * Probe-then-skipIf pattern (matches tests/schema/phase-25-schema.test.ts).
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

describe.skipIf(!dbReachable)("phase-3 pr 3.2 schema — vt_task_ownership_confirm_queue", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = probePool!;
  });

  afterAll(async () => {
    if (probePool) {
      await probePool.end();
    }
  });

  it("table exists", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_name = 'vt_task_ownership_confirm_queue'`,
    );
    expect(rows.length).toBe(1);
  });

  it("has the required columns with expected types + nullability", async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'vt_task_ownership_confirm_queue'`,
    );
    const byName = new Map(rows.map((r) => [r.column_name, r] as const));

    const expected: ReadonlyArray<{ name: string; type: string; nullable: "NO" | "YES" }> = [
      { name: "id", type: "text", nullable: "NO" },
      { name: "clinic_id", type: "text", nullable: "NO" },
      { name: "appointment_id", type: "text", nullable: "NO" },
      { name: "raw_acknowledged_by", type: "text", nullable: "NO" },
      { name: "candidate_user_ids", type: "jsonb", nullable: "NO" },
      { name: "resolution_reason", type: "character varying", nullable: "NO" },
      { name: "matcher_version", type: "character varying", nullable: "NO" },
      { name: "resolved_source", type: "character varying", nullable: "NO" },
      { name: "confirmed_user_id", type: "text", nullable: "YES" },
      { name: "resolved_by_user_id", type: "text", nullable: "YES" },
      { name: "resolved_at", type: "timestamp with time zone", nullable: "YES" },
      { name: "created_by_job_id", type: "text", nullable: "NO" },
      { name: "created_at", type: "timestamp with time zone", nullable: "NO" },
      { name: "updated_at", type: "timestamp with time zone", nullable: "NO" },
    ];

    for (const col of expected) {
      const found = byName.get(col.name);
      expect(found, `missing column ${col.name}`).toBeDefined();
      expect(found!.data_type, `type for ${col.name}`).toBe(col.type);
      expect(found!.is_nullable, `nullability for ${col.name}`).toBe(col.nullable);
    }
  });

  it("FK on clinic_id targets vt_clinics with ON DELETE RESTRICT", async () => {
    const { rows } = await pool.query<{ delete_rule: string; foreign_table: string }>(
      `SELECT rc.delete_rule, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'vt_task_ownership_confirm_queue'
          AND kcu.column_name = 'clinic_id'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].foreign_table).toBe("vt_clinics");
    expect(rows[0].delete_rule).toBe("RESTRICT");
  });

  it("FK on appointment_id targets vt_appointments with ON DELETE CASCADE", async () => {
    const { rows } = await pool.query<{ delete_rule: string; foreign_table: string }>(
      `SELECT rc.delete_rule, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'vt_task_ownership_confirm_queue'
          AND kcu.column_name = 'appointment_id'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].foreign_table).toBe("vt_appointments");
    expect(rows[0].delete_rule).toBe("CASCADE");
  });

  it("unique constraint on (clinic_id, appointment_id, raw_acknowledged_by)", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE tablename = 'vt_task_ownership_confirm_queue'
          AND indexname = 'ux_vt_task_ownership_confirm_queue_triple'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/i);
    expect(rows[0].indexdef).toMatch(/clinic_id/);
    expect(rows[0].indexdef).toMatch(/appointment_id/);
    expect(rows[0].indexdef).toMatch(/raw_acknowledged_by/);
  });

  it("partial index for pending rows by clinic", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE tablename = 'vt_task_ownership_confirm_queue'
          AND indexname = 'idx_vt_task_ownership_confirm_queue_clinic_pending'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toMatch(/resolved_source.*=.*'pending'/i);
    expect(rows[0].indexdef).toMatch(/clinic_id/);
    expect(rows[0].indexdef).toMatch(/created_at/);
  });

  it("appointment_id index exists for reverse lookups", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'vt_task_ownership_confirm_queue'
          AND indexname = 'idx_vt_task_ownership_confirm_queue_appointment'`,
    );
    expect(rows.length).toBe(1);
  });
});
