/**
 * R-M1.2a — directional RFID ingest schema + deterministic precedence.
 * Postgres integration test (requires DATABASE_URL + migrations 172/175).
 *
 * Asserts: a valid directional payload persists (destination resolved); a legacy
 * (no-direction) payload still works byte-for-byte; and a partial gateway pair, a
 * direction/gateway disagreement, and an unknown/cross-clinic gateway are each a HARD
 * REJECT (never a silent downgrade to last-seen). RFID never mutates custody.
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

import { db, equipment, equipmentRfidReads, eventOutbox, rfidEgressSignals } from "../server/db.js";
import { ingestRfidBatch, RfidDirectionalRejection } from "../server/lib/rfid-ingest.js";

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

describeDb("R-M1.2a directional ingest", () => {
  const clinicA = `rfid-dir-a-${randomUUID().slice(0, 8)}`;
  const clinicB = `rfid-dir-b-${randomUUID().slice(0, 8)}`;
  const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
  let roomER: string;
  let roomWard: string;
  let roomLobby: string;
  let roomB: string;
  let equipmentId: string;

  const GW_INT = `GW-INT-${randomUUID().slice(0, 6)}`;
  const GW_BND = `GW-BND-${randomUUID().slice(0, 6)}`;
  const GW_LEG = `GW-LEG-${randomUUID().slice(0, 6)}`;
  const GW_CLINICB = `GW-CB-${randomUUID().slice(0, 6)}`;

  async function insertRoom(clinic: string, name: string, gatewayCode: string | null) {
    const id = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'stale', now(), now())`,
      [id, clinic, name, gatewayCode],
    );
    return id;
  }

  async function insertReader(
    clinic: string,
    gatewayCode: string,
    roomId: string | null,
    fromRoomId: string | null,
    toRoomId: string | null,
    gateType: string | null,
  ) {
    const id = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rfid_readers
         (id, clinic_id, name, gateway_code, room_id, from_room_id, to_room_id, gate_type, provisioning_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        clinic,
        `Reader ${gatewayCode}`,
        gatewayCode,
        roomId,
        fromRoomId,
        toRoomId,
        gateType,
        gateType ? "configured" : "legacy_unconfigured",
      ],
    );
    return id;
  }

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [
      clinicA,
      clinicB,
    ]);
    roomER = await insertRoom(clinicA, "ER", null);
    roomWard = await insertRoom(clinicA, "Ward", null);
    roomLobby = await insertRoom(clinicA, "Lobby", null);
    // legacy path resolves via rooms.gateway_code — keep it a DISTINCT gateway.
    await probePool!.query(`UPDATE vt_rooms SET gateway_code = $2 WHERE id = $1`, [roomER, GW_LEG]);
    roomB = await insertRoom(clinicB, "Clinic B Room", null);

    // internal gate mounted in ER, connecting ER<->Ward
    await insertReader(clinicA, GW_INT, roomER, roomER, roomWard, "internal");
    // boundary gate mounted in Lobby (external = NULL to-endpoint)
    await insertReader(clinicA, GW_BND, roomLobby, roomLobby, null, "boundary");
    // cross-clinic reader
    await insertReader(clinicB, GW_CLINICB, roomB, roomB, null, "boundary");

    equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, custody_state, usage_state, readiness_state, version)
       VALUES ($1, $2, 'Directional Device', 'ok', $3, 'returned', 'available', 'unknown', 1)`,
      [equipmentId, clinicA, tagEpc],
    );
  });

  afterAll(async () => {
    try {
      const clinicIds = [clinicA, clinicB];
      for (const table of [
        "vt_rfid_egress_signals",
        "vt_equipment_rfid_reads",
        "vt_event_outbox",
        "vt_rfid_readers",
        "vt_equipment",
        "vt_rooms",
      ]) {
        await probePool!.query(`DELETE FROM ${table} WHERE clinic_id = ANY($1)`, [clinicIds]);
      }
      await probePool!.query(`DELETE FROM vt_clinics WHERE id = ANY($1)`, [clinicIds]);
    } finally {
      await probePool?.end();
    }
  });

  beforeEach(async () => {
    await probePool!.query(
      `UPDATE vt_equipment SET last_rfid_room_id = NULL, last_rfid_seen_at = NULL, last_rfid_gateway_code = NULL,
        room_id = NULL, custody_state = 'returned', usage_state = 'available'
       WHERE id = $1`,
      [equipmentId],
    );
    await db.delete(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
    await db.delete(rfidEgressSignals).where(eq(rfidEgressSignals.equipmentId, equipmentId));
    await db
      .delete(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinicA), eq(eventOutbox.type, "EQUIPMENT_RFID_OBSERVED")));
  });

  async function loadEquipment() {
    const [row] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicA)));
    return row!;
  }

  // A HARD REJECT must be atomic: no directional read, no egress signal, and no
  // realtime outbox row may leak. `beforeEach` clears all three, so any row here
  // is a partial write from the rejected batch.
  async function expectNoPersistedSideEffects() {
    const reads = await db
      .select()
      .from(equipmentRfidReads)
      .where(eq(equipmentRfidReads.equipmentId, equipmentId));
    expect(reads).toHaveLength(0);

    const egress = await db
      .select()
      .from(rfidEgressSignals)
      .where(eq(rfidEgressSignals.equipmentId, equipmentId));
    expect(egress).toHaveLength(0);

    const outbox = await db
      .select()
      .from(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinicA), eq(eventOutbox.type, "EQUIPMENT_RFID_OBSERVED")));
    expect(outbox).toHaveLength(0);
  }

  it("valid directional payload (exited internal gate) resolves to the destination room", async () => {
    const before = await loadEquipment();
    const result = await ingestRfidBatch(clinicA, {
      batchId: `dir-ok-${randomUUID().slice(0, 6)}`,
      events: [
        {
          tagEpc,
          gatewayCode: GW_INT,
          readAt: "2026-07-16T10:00:00.000Z",
          direction: "exited",
        },
      ],
    });
    expect(result.directionalResolved).toBe(1);
    expect(result.updated).toBe(1);
    const after = await loadEquipment();
    // exited ER gate => destination = the OTHER endpoint (Ward)
    expect(after.lastRfidRoomId).toBe(roomWard);
    // RFID never mutates custody / human room
    expect(after.roomId).toBe(before.roomId);
    expect(after.custodyState).toBe(before.custodyState);
  });

  it("legacy (no-direction) payload still resolves via rooms.gateway_code", async () => {
    const result = await ingestRfidBatch(clinicA, {
      batchId: `legacy-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_LEG, readAt: "2026-07-16T10:05:00.000Z" }],
    });
    expect(result.updated).toBe(1);
    expect(result.directionalResolved).toBe(0);
    const after = await loadEquipment();
    expect(after.lastRfidRoomId).toBe(roomER);
  });

  it("rejects a partial gateway pair (never a silent downgrade)", async () => {
    await expect(
      ingestRfidBatch(clinicA, {
        batchId: `partial-${randomUUID().slice(0, 6)}`,
        events: [{ tagEpc, gatewayCode: GW_INT, readAt: "2026-07-16T10:10:00.000Z", toGateway: GW_BND }],
      }),
    ).rejects.toMatchObject({ code: "PARTIAL_GATEWAY_PAIR" });
    expect(await loadEquipment()).toMatchObject({ lastRfidRoomId: null });
    await expectNoPersistedSideEffects();
  });

  it("rejects a direction/gateway disagreement", async () => {
    await expect(
      ingestRfidBatch(clinicA, {
        batchId: `disagree-${randomUUID().slice(0, 6)}`,
        events: [
          {
            tagEpc,
            gatewayCode: GW_INT,
            readAt: "2026-07-16T10:15:00.000Z",
            direction: "exited",
            fromGateway: GW_BND,
            toGateway: GW_INT, // pair implies 'entered' — contradicts direction 'exited'
          },
        ],
      }),
    ).rejects.toBeInstanceOf(RfidDirectionalRejection);
    expect(await loadEquipment()).toMatchObject({ lastRfidRoomId: null });
    await expectNoPersistedSideEffects();
  });

  it("rejects an unknown / cross-clinic gateway on a directional payload", async () => {
    await expect(
      ingestRfidBatch(clinicA, {
        batchId: `unknown-${randomUUID().slice(0, 6)}`,
        events: [{ tagEpc, gatewayCode: GW_CLINICB, readAt: "2026-07-16T10:20:00.000Z", direction: "entered" }],
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN_GATEWAY" });
    expect(await loadEquipment()).toMatchObject({ lastRfidRoomId: null });
    await expectNoPersistedSideEffects();
  });
});
