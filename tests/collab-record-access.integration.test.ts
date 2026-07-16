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
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('vt_clinics','vt_equipment','vt_rooms','vt_appointments')`,
    );
    dbReachable = rows.length === 4;
  } catch {
    dbReachable = false;
  }
}

const clinicA = `clinic-A-${randomUUID()}`;
const clinicB = `clinic-B-${randomUUID()}`;
const eqId = randomUUID();
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
});
