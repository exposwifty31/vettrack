/**
 * RFID boundary guard — ensures ingest never touches authoritative state tables.
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
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

const describeDb = dbReachable ? describe : describe.skip;

type Snapshot = {
  equipment: Record<string, unknown>;
  stagingCount: number;
  waitlistCount: number;
  scanLogCount: number;
};

async function snapshot(clinicId: string, equipmentId: string): Promise<Snapshot> {
  const { rows: eqRows } = await probePool!.query(
    `SELECT room_id, custody_state, usage_state, readiness_state, last_seen, last_status
     FROM vt_equipment WHERE id = $1 AND clinic_id = $2`,
    [equipmentId, clinicId],
  );
  const { rows: staging } = await probePool!.query(
    `SELECT count(*)::int AS c FROM vt_staging_queue WHERE clinic_id = $1`,
    [clinicId],
  );
  let waitlistCount = 0;
  const { rows: wlTable } = await probePool!.query(
    `SELECT to_regclass('public.vt_equipment_waitlist') AS regclass`,
  );
  if (wlTable[0]?.regclass) {
    const { rows: wl } = await probePool!.query(
      `SELECT count(*)::int AS c FROM vt_equipment_waitlist WHERE clinic_id = $1`,
      [clinicId],
    );
    waitlistCount = wl[0]?.c ?? 0;
  }
  const { rows: scans } = await probePool!.query(
    `SELECT count(*)::int AS c FROM vt_scan_logs WHERE clinic_id = $1`,
    [clinicId],
  );
  return {
    equipment: eqRows[0] ?? {},
    stagingCount: staging[0]?.c ?? 0,
    waitlistCount,
    scanLogCount: scans[0]?.c ?? 0,
  };
}

describeDb("rfid ingest boundary", () => {
  const clinicId = `rfid-boundary-${randomUUID().slice(0, 8)}`;
  let roomA: string;
  let roomB: string;
  let equipmentId: string;
  const gatewayA = `GWA-${randomUUID().slice(0, 4)}`;
  const gatewayB = `GWB-${randomUUID().slice(0, 4)}`;

  beforeAll(async () => {
    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
    roomA = randomUUID();
    roomB = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, gateway_code, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'Dock A', $3, 'stale', now(), now()), ($4, $2, 'Hall B', $5, 'stale', now(), now())`,
      [roomA, clinicId, gatewayA, roomB, gatewayB],
    );
    await probePool!.query(
      `INSERT INTO vt_docks (id, clinic_id, name, room_id, created_at)
       VALUES ($1, $2, 'Main Dock', $3, now())`,
      [randomUUID(), clinicId, roomA],
    );
    equipmentId = randomUUID();
    const tag = `BOUNDARY-${randomUUID().slice(0, 6)}`;
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, room_id, custody_state, usage_state, readiness_state, last_seen, last_status, version)
       VALUES ($1, $2, 'Boundary Device', 'ok', $3, $4, 'checked_out', 'in_use', 'ready', now(), 'ok', 1)`,
      [equipmentId, clinicId, tag, roomB],
    );
  });

  afterAll(async () => {
    await probePool?.end();
  });

  it("50 mixed events do not mutate staging, waitlist, scan logs, or authoritative equipment cols", async () => {
    const before = await snapshot(clinicId, equipmentId);
    const tagRow = await probePool!.query(`SELECT rfid_tag_epc FROM vt_equipment WHERE id = $1`, [equipmentId]);
    const tagEpc = tagRow.rows[0]?.rfid_tag_epc as string;

    const events = Array.from({ length: 50 }, (_, i) => ({
      tagEpc,
      gatewayCode: i % 2 === 0 ? gatewayA : gatewayB,
      readAt: new Date(Date.UTC(2026, 4, 27, 12, 0, i)).toISOString(),
    }));

    await ingestRfidBatch(clinicId, { batchId: "boundary-50", events });

    const after = await snapshot(clinicId, equipmentId);
    expect(after.equipment.room_id).toEqual(before.equipment.room_id);
    expect(after.equipment.custody_state).toEqual(before.equipment.custody_state);
    expect(after.equipment.usage_state).toEqual(before.equipment.usage_state);
    expect(after.equipment.readiness_state).toEqual(before.equipment.readiness_state);
    expect(String(after.equipment.last_seen)).toBe(String(before.equipment.last_seen));
    expect(after.equipment.last_status).toEqual(before.equipment.last_status);
    expect(after.stagingCount).toBe(before.stagingCount);
    expect(after.waitlistCount).toBe(before.waitlistCount);
    expect(after.scanLogCount).toBe(before.scanLogCount);
  });
});
