/**
 * R-M1.2b — adjacency model: a directional read populates
 * vt_equipment_rfid_reads.from_room_id / to_room_id from the reader's configured
 * fromRoomId/toRoomId endpoints (instead of leaving from_room_id null).
 * Postgres integration test (requires DATABASE_URL + migrations 172/175).
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  resolveAuditActorRole: () => "system",
}));

import { db, equipmentRfidReads } from "../server/db.js";
import { ingestRfidBatch } from "../server/lib/rfid-ingest.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_rfid_readers') AS regclass`,
    );
    dbReachable = rows[0]?.regclass != null;
  } catch {
    dbReachable = false;
  }
}

const describeDb = dbReachable ? describe.sequential : describe.skip;

describeDb("R-M1.2b directional adjacency", () => {
  const clinic = `rfid-adj-${randomUUID().slice(0, 8)}`;
  const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
  let roomER: string;
  let roomWard: string;
  let equipmentId: string;
  const GW_INT = `GW-ADJ-${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinic]);
    roomER = randomUUID();
    roomWard = randomUUID();
    for (const [id, name] of [
      [roomER, "ER"],
      [roomWard, "Ward"],
    ]) {
      await probePool!.query(
        `INSERT INTO vt_rooms (id, clinic_id, name, sync_status, created_at, updated_at)
         VALUES ($1, $2, $3, 'stale', now(), now())`,
        [id, clinic, name],
      );
    }
    await probePool!.query(
      `INSERT INTO vt_rfid_readers
         (id, clinic_id, name, gateway_code, room_id, from_room_id, to_room_id, gate_type, provisioning_state)
       VALUES ($1, $2, 'Internal gate', $3, $4, $4, $5, 'internal', 'configured')`,
      [randomUUID(), clinic, GW_INT, roomER, roomWard],
    );
    equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, custody_state, usage_state, readiness_state, version)
       VALUES ($1, $2, 'Adjacency Device', 'ok', $3, 'returned', 'available', 'unknown', 1)`,
      [equipmentId, clinic, tagEpc],
    );
  });

  afterAll(async () => {
    try {
      for (const table of [
        "vt_rfid_egress_signals",
        "vt_equipment_rfid_reads",
        "vt_event_outbox",
        "vt_rfid_readers",
        "vt_equipment",
        "vt_rooms",
      ]) {
        await probePool!.query(`DELETE FROM ${table} WHERE clinic_id = $1`, [clinic]);
      }
      await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinic]);
    } finally {
      await probePool?.end();
    }
  });

  beforeEach(async () => {
    await probePool!.query(
      `UPDATE vt_equipment SET last_rfid_room_id = NULL, last_rfid_seen_at = NULL, last_rfid_gateway_code = NULL WHERE id = $1`,
      [equipmentId],
    );
    await db.delete(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
  });

  async function reads(batchId: string) {
    return db
      .select()
      .from(equipmentRfidReads)
      .where(
        and(eq(equipmentRfidReads.equipmentId, equipmentId), eq(equipmentRfidReads.batchId, batchId)),
      );
  }

  it("an 'exited' read writes from=home, to=away", async () => {
    const batchId = `adj-exit-${randomUUID().slice(0, 6)}`;
    await ingestRfidBatch(clinic, {
      batchId,
      events: [{ tagEpc, gatewayCode: GW_INT, readAt: "2026-07-16T09:00:00.000Z", direction: "exited" }],
    });
    const rows = await reads(batchId);
    expect(rows).toHaveLength(1);
    // gate mounted in ER (home); exited => from ER, to Ward
    expect(rows[0]?.fromRoomId).toBe(roomER);
    expect(rows[0]?.toRoomId).toBe(roomWard);
  });

  it("an 'entered' read writes from=away, to=home", async () => {
    const batchId = `adj-enter-${randomUUID().slice(0, 6)}`;
    await ingestRfidBatch(clinic, {
      batchId,
      events: [{ tagEpc, gatewayCode: GW_INT, readAt: "2026-07-16T09:10:00.000Z", direction: "entered" }],
    });
    const rows = await reads(batchId);
    expect(rows).toHaveLength(1);
    // entered ER gate => arriving at ER (home); from Ward (away), to ER
    expect(rows[0]?.fromRoomId).toBe(roomWard);
    expect(rows[0]?.toRoomId).toBe(roomER);
  });
});
