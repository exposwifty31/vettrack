/**
 * RFID ingest processor — Postgres integration tests.
 * Requires DATABASE_URL and migration 138.
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import { db, equipment, equipmentRfidReads, eventOutbox, auditLogs } from "../server/db.js";
import { ingestRfidBatch } from "../server/lib/rfid-ingest.js";

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

/** Shared clinic/equipment fixtures — must not run in parallel within this file. */
const describeDb = dbReachable ? describe.sequential : describe.skip;

describeDb("ingestRfidBatch", () => {
  const clinicA = `rfid-test-a-${randomUUID().slice(0, 8)}`;
  const clinicB = `rfid-test-b-${randomUUID().slice(0, 8)}`;
  let roomId: string;
  let equipmentId: string;
  const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
  const gatewayCode = `GW-${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [
      clinicA,
      clinicB,
    ]);
    roomId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'RFID Test Room', $3, 'stale', now(), now())`,
      [roomId, clinicA, gatewayCode],
    );
    equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, custody_state, usage_state, readiness_state, version)
       VALUES ($1, $2, 'RFID Tag Device', 'ok', $3, 'returned', 'available', 'unknown', 1)`,
      [equipmentId, clinicA, tagEpc],
    );
  });

  afterAll(async () => {
    await probePool?.end();
  });

  beforeEach(async () => {
    await probePool!.query(
      `UPDATE vt_equipment SET last_rfid_room_id = NULL, last_rfid_seen_at = NULL, last_rfid_gateway_code = NULL,
        room_id = NULL, custody_state = 'returned', usage_state = 'available', readiness_state = 'unknown',
        last_seen = NULL, last_status = NULL
       WHERE id = $1`,
      [equipmentId],
    );
    await db.delete(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
    await db
      .delete(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinicA), eq(eventOutbox.type, "EQUIPMENT_RFID_OBSERVED")));
    await db.delete(auditLogs).where(
      and(
        eq(auditLogs.clinicId, clinicA),
        eq(auditLogs.targetId, equipmentId),
        eq(auditLogs.actionType, "equipment_rfid_observed_room_changed"),
      ),
    );
  });

  async function loadEquipment() {
    const [row] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicA)));
    return row!;
  }

  it("unknown tag increments counter without writes", async () => {
    const beforeReads = await db.select().from(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
    const result = await ingestRfidBatch(clinicA, {
      batchId: "unk-tag",
      events: [{ tagEpc: "UNKNOWN-EPC", gatewayCode, readAt: new Date().toISOString() }],
    });
    expect(result.unknownTag).toBe(1);
    expect(result.updated).toBe(0);
    const afterReads = await db.select().from(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
    expect(afterReads.length).toBe(beforeReads.length);
  });

  it("unknown gateway skips writes", async () => {
    const result = await ingestRfidBatch(clinicA, {
      batchId: "unk-gw",
      events: [{ tagEpc, gatewayCode: "NO-SUCH-GW", readAt: new Date().toISOString() }],
    });
    expect(result.unknownGateway).toBe(1);
    const row = await loadEquipment();
    expect(row.lastRfidSeenAt).toBeNull();
  });

  it("room unchanged updates seen time only — no read log or outbox", async () => {
    const t1 = new Date("2026-05-27T10:00:00.000Z");
    await ingestRfidBatch(clinicA, {
      batchId: "first-move",
      events: [{ tagEpc, gatewayCode, readAt: t1.toISOString() }],
    });
    const t2 = new Date("2026-05-27T10:05:00.000Z");
    const result = await ingestRfidBatch(clinicA, {
      batchId: "same-room",
      events: [{ tagEpc, gatewayCode, readAt: t2.toISOString() }],
    });
    expect(result.unchanged).toBe(1);
    const reads = await db.select().from(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
    expect(reads.length).toBe(1);
    const outbox = await db
      .select()
      .from(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinicA), eq(eventOutbox.type, "EQUIPMENT_RFID_OBSERVED")));
    expect(outbox.length).toBe(1);
    const row = await loadEquipment();
    expect(row.lastRfidSeenAt?.toISOString()).toBe(t2.toISOString());
    expect(row.lastRfidGatewayCode).toBe(gatewayCode);
    expect(row.roomId).toBeNull();
  });

  it("room changed writes advisory cols, read log, audit, outbox — authoritative cols unchanged", async () => {
    const room2 = randomUUID();
    const gw2 = `GW2-${randomUUID().slice(0, 4)}`;
    const batchId = `room-change-${randomUUID().slice(0, 8)}`;
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'Room B', $3, 'stale', now(), now())`,
      [room2, clinicA, gw2],
    );
    await probePool!.query(
      `UPDATE vt_equipment SET custody_state = 'checked_out', usage_state = 'in_use', last_seen = now(), last_status = 'ok', room_id = $2,
        last_rfid_room_id = NULL, last_rfid_seen_at = NULL, last_rfid_gateway_code = NULL
       WHERE id = $1`,
      [equipmentId, roomId],
    );
    await db.delete(equipmentRfidReads).where(eq(equipmentRfidReads.equipmentId, equipmentId));
    await db.delete(auditLogs).where(
      and(
        eq(auditLogs.clinicId, clinicA),
        eq(auditLogs.targetId, equipmentId),
        eq(auditLogs.actionType, "equipment_rfid_observed_room_changed"),
      ),
    );

    const before = await loadEquipment();
    const readAt = new Date("2026-05-27T11:00:00.000Z");
    const result = await ingestRfidBatch(clinicA, {
      batchId,
      events: [{ tagEpc, gatewayCode: gw2, readAt: readAt.toISOString() }],
    });
    expect(result.updated).toBe(1);
    const after = await loadEquipment();
    expect(after.lastRfidRoomId).toBe(room2);
    expect(after.roomId).toBe(before.roomId);
    expect(after.custodyState).toBe(before.custodyState);
    expect(after.usageState).toBe(before.usageState);
    expect(after.readinessState).toBe(before.readinessState);
    expect(after.lastSeen?.toISOString()).toBe(before.lastSeen?.toISOString());
    expect(after.lastStatus).toBe(before.lastStatus);

    const reads = await db
      .select()
      .from(equipmentRfidReads)
      .where(
        and(eq(equipmentRfidReads.equipmentId, equipmentId), eq(equipmentRfidReads.batchId, batchId)),
      );
    expect(reads.length).toBe(1);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.clinicId, clinicA),
          eq(auditLogs.actionType, "equipment_rfid_observed_room_changed"),
          eq(auditLogs.targetId, equipmentId),
        ),
      );
    const auditsForBatch = audits.filter((row) => {
      const meta = row.metadata as { batchId?: string; toRoomId?: string } | null;
      return meta?.batchId === batchId && meta?.toRoomId === room2;
    });
    expect(auditsForBatch).toHaveLength(1);
    expect(auditsForBatch[0]?.metadata).toMatchObject({
      batchId,
      toRoomId: room2,
      readAt: readAt.toISOString(),
    });
  });

  it("concurrent batches: older read cannot regress a newer observation", async () => {
    const newerAt = new Date("2026-05-27T13:00:00.000Z");
    const olderAt = new Date("2026-05-27T12:30:00.000Z");

    await Promise.all([
      ingestRfidBatch(clinicA, {
        batchId: "race-older",
        events: [{ tagEpc, gatewayCode, readAt: olderAt.toISOString() }],
      }),
      ingestRfidBatch(clinicA, {
        batchId: "race-newer",
        events: [{ tagEpc, gatewayCode, readAt: newerAt.toISOString() }],
      }),
    ]);

    const row = await loadEquipment();
    expect(row.lastRfidSeenAt?.toISOString()).toBe(newerAt.toISOString());
    expect(row.lastRfidGatewayCode).toBe(gatewayCode);
  });

  it("stale readAt is ignored", async () => {
    const freshAt = new Date("2026-05-27T12:00:00.000Z");
    await ingestRfidBatch(clinicA, {
      batchId: "seed-fresh",
      events: [{ tagEpc, gatewayCode, readAt: freshAt.toISOString() }],
    });
    const row = await loadEquipment();
    const staleAt = new Date(freshAt.getTime() - 60_000);
    const result = await ingestRfidBatch(clinicA, {
      batchId: "stale",
      events: [{ tagEpc, gatewayCode, readAt: staleAt.toISOString() }],
    });
    expect(result.stale).toBe(1);
    const after = await loadEquipment();
    expect(after.lastRfidSeenAt?.toISOString()).toBe(row.lastRfidSeenAt?.toISOString());
  });

  it("cross-clinic tags are unknown", async () => {
    const result = await ingestRfidBatch(clinicB, {
      batchId: "cross",
      events: [{ tagEpc, gatewayCode, readAt: new Date().toISOString() }],
    });
    expect(result.unknownTag).toBe(1);
  });

  it("200-event batch counters sum to coalesced unique tags", async () => {
    const tags = Array.from({ length: 50 }, (_, i) => `BATCH-EPC-${i}`);
    for (let i = 0; i < tags.length; i++) {
      const id = randomUUID();
      await probePool!.query(
        `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, custody_state, usage_state, readiness_state, version)
         VALUES ($1, $2, $3, 'ok', $4, 'returned', 'available', 'unknown', 1)`,
        [id, clinicA, `Batch ${i}`, tags[i]],
      );
    }
    const events = tags.flatMap((tag, i) => [
      { tagEpc: tag, gatewayCode, readAt: new Date(`2026-05-27T12:${String(i % 60).padStart(2, "0")}:00.000Z`).toISOString() },
      { tagEpc: tag, gatewayCode, readAt: new Date(`2026-05-27T12:${String((i + 1) % 60).padStart(2, "0")}:01.000Z`).toISOString() },
    ]);
    const result = await ingestRfidBatch(clinicA, { batchId: "big", events });
    expect(result.accepted).toBe(100);
    const accounted =
      result.updated +
      result.unchanged +
      result.unknownTag +
      result.unknownGateway +
      result.stale;
    expect(accounted).toBe(50);
  });
});
