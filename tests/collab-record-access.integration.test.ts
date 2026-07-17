/**
 * R-RTC-1.1/1.4 — REAL clinic-scoped record ACL (defaultRecordAccessCheck).
 *
 * Every other collab test injects a stub RecordAccessCheck, so the production
 * clinicId-scoped existence query in server/lib/realtime-collab/record-access.ts
 * runs ZERO times in CI — a silent drop of the `eq(table.clinicId, ...)` filter
 * would still pass every existing test. This exercises the real query end-to-end:
 * a clinic-A identity may join a clinic-A record room; a clinic-B identity (same
 * record id) is denied. Covers all three RecordTypes + a non-existent id.
 *
 * DB-integration convention: gated on DATABASE_URL reachability (skips cleanly
 * when no DB). Run: pnpm test tests/collab-record-access.integration.test.ts
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { defaultRecordAccessCheck } from "../server/lib/realtime-collab/record-access.js";
import { RECORD_TYPES, type CollabIdentity, type RecordType } from "../server/lib/realtime-collab/rooms.js";

// ── DB probe (same URL the db.js singleton reads) ───────────────────────────
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const REQUIRED_TABLES = ["vt_clinics", "vt_equipment", "vt_rooms", "vt_appointments"] as const;
let probePool: Pool | null = null;
// Reachability is derived from `SELECT 1` ALONE. A MISSING required table must NOT
// collapse into "unreachable" — that would silently SKIP the whole tenancy-SECURITY
// suite when the DB is present but under-migrated. Reachability gates the skip; table
// presence is captured separately and surfaced as a FAILURE in beforeAll. — PR#112 (c).
let dbReachable = false;
let requiredTablesPresent = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
    const { rows } = await probePool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = ANY($1)`,
      [REQUIRED_TABLES as unknown as string[]],
    );
    requiredTablesPresent = rows.length === REQUIRED_TABLES.length;
  } catch {
    // Only a genuine connection/query failure means unreachable → clean skip.
    dbReachable = false;
  }
}

const clinicA = `clinic-A-${randomUUID()}`;
const clinicB = `clinic-B-${randomUUID()}`;
const eqId = randomUUID();
const softDeletedEqId = randomUUID();
const roomId = randomUUID();
const taskId = randomUUID();

const identityFor = (clinicId: string): CollabIdentity => ({
  userId: `u-${clinicId}`,
  clinicId,
  role: "vet",
  displayName: "Dr. X",
});

/** The clinic-A record id for each RecordType. */
const idForType: Record<RecordType, string> = {
  equipment: eqId,
  room: roomId,
  task: taskId,
};

async function seed() {
  const P = probePool!;
  await P.query(`INSERT INTO vt_clinics (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [clinicA, clinicB]);
  await P.query(`INSERT INTO vt_equipment (id, clinic_id, name) VALUES ($1, $2, $3)`, [eqId, clinicA, "ACL Test Pump"]);
  // A SOFT-DELETED equipment record in the SAME clinic: must NOT authorize a room join
  // (the REST record path filters isNull(deleted_at); the collab ACL must match).
  await P.query(
    `INSERT INTO vt_equipment (id, clinic_id, name, deleted_at) VALUES ($1, $2, $3, now())`,
    [softDeletedEqId, clinicA, "ACL Test Deleted Pump"],
  );
  await P.query(`INSERT INTO vt_rooms (id, clinic_id, name) VALUES ($1, $2, $3)`, [roomId, clinicA, "ACL Test Room"]);
  await P.query(
    `INSERT INTO vt_appointments (id, clinic_id, start_time, end_time)
     VALUES ($1, $2, now(), now() + interval '1 hour')`,
    [taskId, clinicA],
  );
}

async function purge() {
  const P = probePool!;
  await P.query(`DELETE FROM vt_appointments WHERE clinic_id = ANY($1)`, [[clinicA, clinicB]]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = ANY($1)`, [[clinicA, clinicB]]);
  await P.query(`DELETE FROM vt_rooms WHERE clinic_id = ANY($1)`, [[clinicA, clinicB]]);
  await P.query(`DELETE FROM vt_clinics WHERE id = ANY($1)`, [[clinicA, clinicB]]);
}

describe.skipIf(!dbReachable)("defaultRecordAccessCheck — real clinic-scoped ACL (R-RTC-1.1/1.4)", () => {
  beforeAll(async () => {
    if (!dbReachable) throw new Error("DATABASE_URL required");
    // The DB is reachable but under-migrated: SURFACE it as a failure — never let a
    // missing required table silently skip this tenancy-security suite. — PR#112 (c).
    if (!requiredTablesPresent) {
      throw new Error(
        `required tables missing (${REQUIRED_TABLES.join(", ")}) — run migrations before this suite`,
      );
    }
    await purge(); // clean any leftovers
    await seed();
  });

  afterAll(async () => {
    if (probePool) {
      await purge();
      await probePool.end();
      probePool = null;
    }
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await probePool!.query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  for (const type of RECORD_TYPES) {
    it(`grants a same-clinic ${type} record to the owning clinic`, async () => {
      const allowed = await defaultRecordAccessCheck(identityFor(clinicA), type, idForType[type]);
      expect(allowed).toBe(true);
    });

    it(`DENIES a clinic-B identity the identical clinic-A ${type} record id (tenancy floor)`, async () => {
      const allowed = await defaultRecordAccessCheck(identityFor(clinicB), type, idForType[type]);
      expect(allowed).toBe(false);
    });

    it(`denies a non-existent ${type} id`, async () => {
      const allowed = await defaultRecordAccessCheck(identityFor(clinicA), type, randomUUID());
      expect(allowed).toBe(false);
    });
  }

  it("DENIES a SOFT-DELETED equipment record to its OWN clinic (soft-delete parity with the REST path)", async () => {
    const allowed = await defaultRecordAccessCheck(identityFor(clinicA), "equipment", softDeletedEqId);
    expect(allowed).toBe(false);
  });
});
