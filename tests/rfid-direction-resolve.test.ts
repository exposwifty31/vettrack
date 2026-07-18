/**
 * R-M1.2c — directional resolver + idempotent possible_egress.
 * Postgres integration test (requires DATABASE_URL + migrations 172/175).
 *
 * Asserts: a directional move resolves last-seen to the destination room; a
 * boundary-exit-without-entry emits EXACTLY ONE possible_egress; a retry emits no
 * duplicate; an out-of-order re-report of the same read emits no duplicate; and a
 * matching prior entry suppresses the egress. RFID never mutates custody.
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

import { db, equipment, rfidEgressSignals } from "../server/db.js";
import { ingestRfidBatch } from "../server/lib/rfid-ingest.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_rfid_egress_signals') AS regclass`,
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

describeDb("R-M1.2c directional resolve + possible_egress", () => {
  const clinic = `rfid-res-${randomUUID().slice(0, 8)}`;
  const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
  let roomER: string;
  let roomWard: string;
  let roomLobby: string;
  let equipmentId: string;
  const GW_INT = `GW-RES-${randomUUID().slice(0, 6)}`;
  const GW_BND = `GW-BND-${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinic]);
    roomER = randomUUID();
    roomWard = randomUUID();
    roomLobby = randomUUID();
    for (const [id, name] of [
      [roomER, "ER"],
      [roomWard, "Ward"],
      [roomLobby, "Lobby"],
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
    await probePool!.query(
      `INSERT INTO vt_rfid_readers
         (id, clinic_id, name, gateway_code, room_id, from_room_id, to_room_id, gate_type, provisioning_state)
       VALUES ($1, $2, 'Boundary gate', $3, $4, $4, NULL, 'boundary', 'configured')`,
      [randomUUID(), clinic, GW_BND, roomLobby],
    );
    equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, custody_state, usage_state, readiness_state, version)
       VALUES ($1, $2, 'Resolve Device', 'ok', $3, 'returned', 'available', 'unknown', 1)`,
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
      `UPDATE vt_equipment SET last_rfid_room_id = NULL, last_rfid_seen_at = NULL, last_rfid_gateway_code = NULL,
        room_id = NULL, custody_state = 'returned' WHERE id = $1`,
      [equipmentId],
    );
    await probePool!.query(`DELETE FROM vt_equipment_rfid_reads WHERE equipment_id = $1`, [equipmentId]);
    await db.delete(rfidEgressSignals).where(eq(rfidEgressSignals.equipmentId, equipmentId));
  });

  async function egressRows() {
    return db
      .select()
      .from(rfidEgressSignals)
      .where(and(eq(rfidEgressSignals.clinicId, clinic), eq(rfidEgressSignals.equipmentId, equipmentId)));
  }

  async function lastRfidRoomId() {
    const [row] = await db
      .select({ lastRfidRoomId: equipment.lastRfidRoomId, custodyState: equipment.custodyState })
      .from(equipment)
      .where(eq(equipment.id, equipmentId));
    return row!;
  }

  it("directional resolve places last-seen at the destination room", async () => {
    const result = await ingestRfidBatch(clinic, {
      batchId: `res-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_INT, readAt: "2026-07-16T08:00:00.000Z", direction: "exited" }],
    });
    expect(result.directionalResolved).toBe(1);
    const row = await lastRfidRoomId();
    expect(row.lastRfidRoomId).toBe(roomWard);
    expect(row.custodyState).toBe("returned"); // never mutated
  });

  it("boundary exit without a matching entry emits exactly one possible_egress", async () => {
    const result = await ingestRfidBatch(clinic, {
      batchId: `egr-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_BND, readAt: "2026-07-16T08:10:00.000Z", direction: "exited" }],
    });
    expect(result.possibleEgress).toBe(1);
    const rows = await egressRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fromRoomId).toBe(roomLobby);
    // an external exit must NOT overwrite last-seen room, and never mutates custody
    const eq = await lastRfidRoomId();
    expect(eq.custodyState).toBe("returned");
  });

  it("a retry of the same egress read emits no duplicate", async () => {
    const readAt = "2026-07-16T08:20:00.000Z";
    const first = await ingestRfidBatch(clinic, {
      batchId: `egr-first-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_BND, readAt, direction: "exited" }],
    });
    expect(first.possibleEgress).toBe(1);
    // Same intrinsic read, DIFFERENT batchId (a controller retry) -> deduped by correlation key.
    const retry = await ingestRfidBatch(clinic, {
      batchId: `egr-retry-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_BND, readAt, direction: "exited" }],
    });
    expect(retry.possibleEgress).toBe(0);
    expect(await egressRows()).toHaveLength(1);
  });

  it("an out-of-order re-report of the same read produces no duplicate", async () => {
    const readAt = "2026-07-16T08:30:00.000Z";
    await ingestRfidBatch(clinic, {
      batchId: `egr-a-${randomUUID().slice(0, 6)}`,
      events: [
        { tagEpc, gatewayCode: GW_BND, readAt, direction: "exited" },
        { tagEpc, gatewayCode: GW_BND, readAt: "2026-07-16T08:31:00.000Z", direction: "exited" },
      ],
    });
    // A reordered batch that re-reports the earlier read: no new/contradictory signal.
    const reordered = await ingestRfidBatch(clinic, {
      batchId: `egr-b-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_BND, readAt, direction: "exited" }],
    });
    expect(reordered.possibleEgress).toBe(0);
    // exactly one row per distinct readAt (08:30 and 08:31), never a duplicate of either.
    const rows = await egressRows();
    // Both distinct reads must have persisted (the size-vs-length check below
    // is vacuously true for 0 or 1 rows, so pin the exact expected count first).
    expect(rows).toHaveLength(2);
    const distinctReadAts = new Set(rows.map((r) => r.detectedAt.toISOString()));
    expect(distinctReadAts.size).toBe(rows.length);
  });

  it("a matching prior entry suppresses the possible_egress", async () => {
    // entry through the boundary gate first (dest = Lobby internal room)
    await ingestRfidBatch(clinic, {
      batchId: `enter-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_BND, readAt: "2026-07-16T08:40:00.000Z", direction: "entered" }],
    });
    // then exit through the same boundary gate -> matching entry -> no egress
    const result = await ingestRfidBatch(clinic, {
      batchId: `exit-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_BND, readAt: "2026-07-16T08:41:00.000Z", direction: "exited" }],
    });
    expect(result.possibleEgress).toBe(0);
    expect(await egressRows()).toHaveLength(0);
  });
});
