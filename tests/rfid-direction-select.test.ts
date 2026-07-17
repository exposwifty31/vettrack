/**
 * RFID directional projection — Postgres integration test (R-M1.4 re-attempt).
 * Requires DATABASE_URL and migration 138 (vt_equipment_rfid_reads).
 *
 * PINNED regression: `equipmentRfidSelect` must resolve `lastRfidFromRoomName`
 * from the SAME latest read that set `lastRfidRoomId` (its `to_room_id`). The
 * prior projection filtered `AND rd.from_room_id IS NOT NULL`, so a NULL-origin
 * latest crossing (M1.2c "entered from external": from=NULL) fell through to an
 * OLDER read that happened to have an origin — fabricating a from→to movement
 * that never happened. This test drives that exact cross-read divergence.
 *
 * Self-skips (never runs migrations, creates its own isolated clinic + tears it
 * down) so it is safe against the seeded dev DB.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";

import { db, equipment } from "../server/db.js";
import { equipmentRfidSelect } from "../server/routes/equipment/equipment-rfid-select.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_equipment_rfid_reads') AS regclass`,
    );
    dbReachable = rows[0]?.regclass != null;
  } catch {
    dbReachable = false;
  }
}

// The suite's afterAll (which ends probePool) only runs when the suite runs.
// If a URL was configured but the DB/schema is unusable, the suite is skipped —
// so close the probe pool here to avoid leaking an open connection.
if (probePool && !dbReachable) {
  await probePool.end();
}

const describeDb = dbReachable ? describe.sequential : describe.skip;

describeDb("equipmentRfidSelect — single-crossing from/to pairing", () => {
  const clinicId = `rfid-dir-sel-${randomUUID().slice(0, 8)}`;
  const erRoomId = randomUUID();
  const wardRoomId = randomUUID();
  const receptionRoomId = randomUUID();
  const equipmentId = randomUUID();

  async function insertRead(
    fromRoomId: string | null,
    toRoomId: string,
    readAt: string,
  ): Promise<void> {
    await probePool!.query(
      `INSERT INTO vt_equipment_rfid_reads
         (id, clinic_id, equipment_id, from_room_id, to_room_id, gateway_code, read_at, batch_id)
       VALUES ($1, $2, $3, $4, $5, 'GW-DIR', $6, $7)`,
      [randomUUID(), clinicId, equipmentId, fromRoomId, toRoomId, readAt, randomUUID()],
    );
  }

  async function setLastRfidRoom(roomId: string, seenAt: string): Promise<void> {
    await probePool!.query(
      `UPDATE vt_equipment SET last_rfid_room_id = $1, last_rfid_seen_at = $2 WHERE id = $3`,
      [roomId, seenAt, equipmentId],
    );
  }

  async function project() {
    const [row] = await db
      .select(equipmentRfidSelect(clinicId))
      .from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)));
    return row!;
  }

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [
      clinicId,
    ]);
    for (const [id, name] of [
      [erRoomId, "ER"],
      [wardRoomId, "Ward"],
      [receptionRoomId, "Reception"],
    ] as const) {
      await probePool!.query(
        `INSERT INTO vt_rooms (id, clinic_id, name, sync_status, created_at, updated_at)
         VALUES ($1, $2, $3, 'stale', now(), now())`,
        [id, clinicId, name],
      );
    }
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, custody_state, usage_state, readiness_state, version)
       VALUES ($1, $2, 'RFID Dir Device', 'ok', 'returned', 'available', 'unknown', 1)`,
      [equipmentId, clinicId],
    );
  });

  beforeEach(async () => {
    await probePool!.query(`DELETE FROM vt_equipment_rfid_reads WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(
      `UPDATE vt_equipment SET last_rfid_room_id = NULL, last_rfid_seen_at = NULL WHERE id = $1`,
      [equipmentId],
    );
  });

  afterAll(async () => {
    try {
      for (const table of ["vt_equipment_rfid_reads", "vt_equipment", "vt_rooms"]) {
        await probePool!.query(`DELETE FROM ${table} WHERE clinic_id = $1`, [clinicId]);
      }
      await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
    } finally {
      await probePool?.end();
    }
  });

  it("pairs an accurate directional last-seen from a single crossing (ER → Ward)", async () => {
    await insertRead(erRoomId, wardRoomId, "2026-07-17T10:00:00.000Z");
    await setLastRfidRoom(wardRoomId, "2026-07-17T10:00:00.000Z");

    const row = await project();
    expect(row.lastRfidRoomName).toBe("Ward");
    expect(row.lastRfidFromRoomName).toBe("ER");
  });

  it("does NOT fabricate an origin when the latest crossing has a NULL origin (entered-from-external)", async () => {
    // t1: a genuine ER → Ward crossing (from resolved).
    await insertRead(erRoomId, wardRoomId, "2026-07-17T10:00:00.000Z");
    // t2 (later): re-enters via a dock/boundary gate from outside — from_room_id NULL,
    // destination Reception. This read set last_rfid_room_id = Reception.
    await insertRead(null, receptionRoomId, "2026-07-17T11:00:00.000Z");
    await setLastRfidRoom(receptionRoomId, "2026-07-17T11:00:00.000Z");

    const row = await project();
    // Destination follows the latest crossing.
    expect(row.lastRfidRoomName).toBe("Reception");
    // Origin must come from that SAME latest read (NULL), NOT the stale t1 "ER".
    expect(row.lastRfidFromRoomName).toBeNull();
  });
});
