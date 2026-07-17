/**
 * R-M1.1d — Reader-offline detection sweep. Postgres integration tests.
 * Requires DATABASE_URL + migrations through 174.
 *
 * PINNED semantics under test:
 *   - staleness is computed from vt_rfid_readers.last_reader_heartbeat_at (the reader's OWN
 *     heartbeat), NEVER equipment.last_rfid* asset traffic;
 *   - the `rfid_reader_offline` signal (and its clear) is emitted ONLY on a status CHANGE —
 *     crossing the threshold emits exactly ONE offline signal; offline->healthy emits ONE clear;
 *     repeated sweeps while unchanged emit nothing (dedup);
 *   - the sweep NEVER mutates custody (R-M1 guardrail 1);
 *   - an accepted ingest batch server-sets last_reader_heartbeat_at (never the client readAt),
 *     and still never touches custody.
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";

// Audit is append-only (DO INSTEAD NOTHING delete rule) with a RESTRICT clinic FK: real audit
// rows would make the test clinic permanently undeletable. Mock it (mirrors rfid-ingest.test.ts).
vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  resolveAuditActorRole: () => "system",
}));

import { db, equipment, eventOutbox, rfidReaders, rooms } from "../server/db.js";
import { ingestRfidBatch } from "../server/lib/rfid-ingest.js";
import {
  RFID_READER_OFFLINE_EVENT,
  RFID_READER_RECOVERED_EVENT,
  runRfidReaderOfflineSweep,
} from "../server/lib/rfid/reader-offline-sweep.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ col: string | null }>(
      `SELECT column_name AS col FROM information_schema.columns
        WHERE table_name = 'vt_rfid_readers' AND column_name = 'reader_health_status'`,
    );
    dbReachable = rows.length > 0;
  } catch {
    dbReachable = false;
  }
}

const describeDb = dbReachable ? describe.sequential : describe.skip;

const FIVE_MIN_MS = 5 * 60 * 1000;

describeDb("runRfidReaderOfflineSweep", () => {
  const clinicId = `rfid-offline-${randomUUID().slice(0, 8)}`;
  let roomId: string;

  async function insertReader(opts: {
    gatewayCode: string;
    lastReaderHeartbeatAt: Date | null;
    healthStatus?: string;
    status?: string;
  }): Promise<string> {
    const id = randomUUID();
    await db.insert(rfidReaders).values({
      id,
      clinicId,
      name: `reader-${opts.gatewayCode}`,
      gatewayCode: opts.gatewayCode,
      roomId,
      status: opts.status ?? "active",
      lastReaderHeartbeatAt: opts.lastReaderHeartbeatAt,
      readerHealthStatus: opts.healthStatus ?? "unknown",
      provisioningState: "legacy_unconfigured",
    });
    return id;
  }

  async function countOutbox(type: string): Promise<number> {
    const out = await db
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinicId), eq(eventOutbox.type, type)));
    return out.length;
  }

  async function readerHealth(id: string): Promise<string> {
    const [row] = await db
      .select({ h: rfidReaders.readerHealthStatus })
      .from(rfidReaders)
      .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.id, id)));
    return row?.h ?? "";
  }

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
    roomId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'ER', $3, 'synced', now(), now())`,
      [roomId, clinicId, `GW-ROOM-${randomUUID().slice(0, 6)}`],
    );
  });

  afterAll(async () => {
    await probePool!.query(`DELETE FROM vt_event_outbox WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_rfid_readers WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
    await probePool!.end();
    await db.$client.end?.();
  });

  it("healthy->offline emits exactly ONE offline signal; unchanged sweeps emit nothing", async () => {
    const now = new Date();
    const readerId = await insertReader({ gatewayCode: `GW-A-${randomUUID().slice(0, 6)}`, lastReaderHeartbeatAt: now });

    // First sweep with a fresh heartbeat: unknown -> healthy is NOT a degradation, no signal.
    await runRfidReaderOfflineSweep(now);
    expect(await readerHealth(readerId)).toBe("healthy");
    const offlineBaseline = await countOutbox(RFID_READER_OFFLINE_EVENT);

    // Age the heartbeat past the threshold.
    await db
      .update(rfidReaders)
      .set({ lastReaderHeartbeatAt: new Date(now.getTime() - 2 * FIVE_MIN_MS) })
      .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.id, readerId)));

    // Crossing the threshold: exactly ONE offline signal.
    await runRfidReaderOfflineSweep(now);
    expect(await readerHealth(readerId)).toBe("offline");
    expect(await countOutbox(RFID_READER_OFFLINE_EVENT)).toBe(offlineBaseline + 1);

    // Repeated sweeps while still offline: dedup — NO new signal.
    await runRfidReaderOfflineSweep(now);
    await runRfidReaderOfflineSweep(now);
    expect(await countOutbox(RFID_READER_OFFLINE_EVENT)).toBe(offlineBaseline + 1);
  });

  it("offline->healthy emits exactly ONE clear; unchanged sweeps emit nothing", async () => {
    const now = new Date();
    const readerId = await insertReader({
      gatewayCode: `GW-B-${randomUUID().slice(0, 6)}`,
      lastReaderHeartbeatAt: new Date(now.getTime() - 2 * FIVE_MIN_MS),
      healthStatus: "offline",
    });

    const clearBaseline = await countOutbox(RFID_READER_RECOVERED_EVENT);

    // Still offline: no clear.
    await runRfidReaderOfflineSweep(now);
    expect(await countOutbox(RFID_READER_RECOVERED_EVENT)).toBe(clearBaseline);

    // Fresh heartbeat -> recovery: exactly ONE clear.
    await db
      .update(rfidReaders)
      .set({ lastReaderHeartbeatAt: now })
      .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.id, readerId)));
    await runRfidReaderOfflineSweep(now);
    expect(await readerHealth(readerId)).toBe("healthy");
    expect(await countOutbox(RFID_READER_RECOVERED_EVENT)).toBe(clearBaseline + 1);

    // Repeated sweeps while healthy: dedup — NO new clear.
    await runRfidReaderOfflineSweep(now);
    await runRfidReaderOfflineSweep(now);
    expect(await countOutbox(RFID_READER_RECOVERED_EVENT)).toBe(clearBaseline + 1);
  });

  it("a healthy-but-quiet reader (recent heartbeat, no asset traffic) is NEVER marked offline", async () => {
    const now = new Date();
    // Heartbeat is recent but there is zero equipment.last_rfid* traffic for this reader.
    const readerId = await insertReader({
      gatewayCode: `GW-QUIET-${randomUUID().slice(0, 6)}`,
      lastReaderHeartbeatAt: new Date(now.getTime() - FIVE_MIN_MS / 2),
    });
    const offlineBaseline = await countOutbox(RFID_READER_OFFLINE_EVENT);

    await runRfidReaderOfflineSweep(now);
    await runRfidReaderOfflineSweep(now);

    expect(await readerHealth(readerId)).toBe("healthy");
    expect(await countOutbox(RFID_READER_OFFLINE_EVENT)).toBe(offlineBaseline);
  });

  it("an inactive (deactivated) reader is excluded from the sweep — no offline signal", async () => {
    const now = new Date();
    const readerId = await insertReader({
      gatewayCode: `GW-OFF-${randomUUID().slice(0, 6)}`,
      lastReaderHeartbeatAt: new Date(now.getTime() - 2 * FIVE_MIN_MS),
      healthStatus: "healthy",
      status: "inactive",
    });
    const offlineBaseline = await countOutbox(RFID_READER_OFFLINE_EVENT);

    await runRfidReaderOfflineSweep(now);

    // Untouched: status stays as-persisted, no signal.
    expect(await readerHealth(readerId)).toBe("healthy");
    expect(await countOutbox(RFID_READER_OFFLINE_EVENT)).toBe(offlineBaseline);
  });

  it("the sweep NEVER mutates equipment custody (R-M1 guardrail 1)", async () => {
    const now = new Date();
    const equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, custody_state, checked_out_by_id)
       VALUES ($1, $2, 'Monitor', 'checked_out', 'tech-1')`,
      [equipmentId, clinicId],
    );
    await insertReader({
      gatewayCode: `GW-CUST-${randomUUID().slice(0, 6)}`,
      lastReaderHeartbeatAt: new Date(now.getTime() - 2 * FIVE_MIN_MS),
      healthStatus: "healthy",
    });

    await runRfidReaderOfflineSweep(now);

    const [row] = await db
      .select({ custodyState: equipment.custodyState, checkedOutById: equipment.checkedOutById })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)));
    expect(row?.custodyState).toBe("checked_out");
    expect(row?.checkedOutById).toBe("tech-1");
  });

  it("an accepted ingest batch server-sets last_reader_heartbeat_at (not the client readAt) without touching custody", async () => {
    const gatewayCode = `GW-INGEST-${randomUUID().slice(0, 6)}`;
    const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
    // Ingest resolves the room via rooms.gateway_code (legacy path, R-M1.2 flip is a later card).
    const ingestRoomId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'Ward', $3, 'synced', now(), now())`,
      [ingestRoomId, clinicId, gatewayCode],
    );
    const equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, rfid_tag_epc, custody_state, checked_out_by_id)
       VALUES ($1, $2, 'Pump', $3, 'checked_out', 'tech-9')`,
      [equipmentId, clinicId, tagEpc],
    );
    const readerId = randomUUID();
    await db.insert(rfidReaders).values({
      id: readerId,
      clinicId,
      name: `reader-${gatewayCode}`,
      gatewayCode,
      roomId: ingestRoomId,
      status: "active",
      lastReaderHeartbeatAt: null,
      readerHealthStatus: "unknown",
      provisioningState: "legacy_unconfigured",
    });

    const clientReadAt = new Date(Date.now() - 60 * 60 * 1000); // 1h in the past — client-supplied
    const before = Date.now();
    await ingestRfidBatch(clinicId, {
      batchId: randomUUID(),
      events: [{ tagEpc, gatewayCode, readAt: clientReadAt.toISOString() }],
    });
    const after = Date.now();

    const [reader] = await db
      .select({ hb: rfidReaders.lastReaderHeartbeatAt })
      .from(rfidReaders)
      .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.id, readerId)));
    expect(reader?.hb).toBeTruthy();
    const hbMs = reader!.hb!.getTime();
    // Server time, NOT the client readAt.
    expect(hbMs).toBeGreaterThanOrEqual(before - 1000);
    expect(hbMs).toBeLessThanOrEqual(after + 1000);
    expect(hbMs).not.toBe(clientReadAt.getTime());

    // Custody is untouched by the RFID path.
    const [eq0] = await db
      .select({ custodyState: equipment.custodyState, checkedOutById: equipment.checkedOutById })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)));
    expect(eq0?.custodyState).toBe("checked_out");
    expect(eq0?.checkedOutById).toBe("tech-9");
  });
});
