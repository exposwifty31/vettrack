/**
 * R-M1.5 — RFID gate end-to-end acceptance (the acceptance bar).
 *
 * Drives the full smoke path against a real Postgres: sign a directional batch with the
 * webhook HMAC → POST /api/rfid/events (raw body) → assert the deterministic outcome across
 * every surface the M1.0–M1.4 cards built:
 *
 *   (1) the directional resolver places last-seen at the DESTINATION room AND records the
 *       direction (exited ER → Ward) on the persisted reads row + the equipment-list projection;
 *   (2) it surfaces on the Command Board snapshot (buildCommandBoardSnapshot) AND the
 *       equipment-list RFID projection (equipmentRfidSelect);
 *   (3) an offline reader raises the board `rfid_reader_offline` alert — the test EXPLICITLY
 *       advances time past the staleness threshold and runs the reader-offline sweep to force
 *       the healthy→offline transition; ingestion alone never produces offline status.
 *
 * Negative bars: a cross-clinic reader/gateway is rejected (422, no mutation); partial gateway
 * coverage degrades to LAST-KNOWN (no "unresolved"/unknown regression).
 *
 * FROZEN R-M1 guardrail: RFID NEVER mutates custody — asserted after every mutating step.
 *
 * DB-integration: requires DATABASE_URL + migrations through the R-M1 schema. Self-skips when
 * the DB (or the R-M1 tables/columns) is unreachable.
 */

import "dotenv/config";
import { createHmac, randomUUID } from "crypto";
import express from "express";
import http, { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";

// Audit is append-only (DO INSTEAD NOTHING delete rule) + RESTRICT clinic FK: real audit rows
// would make the test clinic permanently undeletable. Mock it (mirrors the sibling RFID tests).
vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  resolveAuditActorRole: () => "system",
}));

import { db, equipment, equipmentRfidReads, eventOutbox, rfidReaders } from "../server/db.js";
import rfidRoutes from "../server/routes/rfid.js";
import { equipmentRfidSelect } from "../server/routes/equipment/equipment-rfid-select.js";
import { buildCommandBoardSnapshot } from "../server/services/equipment-command-board.service.js";
import { storeCredentials } from "../server/integrations/credential-manager.js";
import { setRfidIngestEnabled, __resetRfidConfigCacheForTests } from "../server/lib/rfid/config.js";
import {
  RFID_READER_OFFLINE_EVENT,
  runRfidReaderOfflineSweep,
} from "../server/lib/rfid/reader-offline-sweep.js";
import { READER_HEARTBEAT_ONLINE_WINDOW_MS } from "../shared/rfid-readers.js";

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
    const egress = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_rfid_egress_signals') AS regclass`,
    );
    dbReachable = rows.length > 0 && egress.rows[0]?.regclass != null;
  } catch {
    dbReachable = false;
  }
}

const describeDb = dbReachable ? describe.sequential : describe.skip;

const SECRET = `e2e-secret-${randomUUID().slice(0, 8)}`;
const OFFLINE_AGE_MS = 3 * READER_HEARTBEAT_ONLINE_WINDOW_MS;

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function buildApp() {
  const app = express();
  app.use("/api/rfid", express.raw({ type: () => true, limit: "512kb" }), rfidRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

async function postRfid(
  body: Buffer,
  headers: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(`${baseUrl}/api/rfid/events`);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { ...headers, "Content-Length": String(body.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> = {};
          if (text) {
            try {
              json = JSON.parse(text) as Record<string, unknown>;
            } catch {
              json = { raw: text };
            }
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Sign + POST a batch for `clinic` with the provisioned secret. */
async function postBatch(clinic: string, batch: unknown, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(batch));
  return postRfid(body, {
    "content-type": "application/json",
    "x-vetrack-clinic": clinic,
    "x-vetrack-signature": sign(body, secret),
  });
}

describeDb("R-M1.5 RFID gate e2e (smoke path)", () => {
  const clinic = `rfid-e2e-${randomUUID().slice(0, 8)}`;
  const otherClinic = `rfid-e2e-other-${randomUUID().slice(0, 8)}`;
  const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
  let roomER: string;
  let roomWard: string;
  let equipmentId: string;
  let internalReaderId: string;
  const GW_INT = `GW-INT-${randomUUID().slice(0, 6)}`;
  const GW_OTHER = `GW-OTHER-${randomUUID().slice(0, 6)}`;
  const GW_NOWHERE = `GW-NOWHERE-${randomUUID().slice(0, 6)}`;
  const CHECKED_OUT_BY = "tech-custody-guard";

  beforeAll(async () => {
    server = createServer(buildApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    for (const c of [clinic, otherClinic]) {
      await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [c]);
    }

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

    // Internal directional gate: home = ER, away = Ward → an "exited" crossing resolves to Ward.
    internalReaderId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rfid_readers
         (id, clinic_id, name, gateway_code, room_id, from_room_id, to_room_id, gate_type, provisioning_state, status, reader_health_status)
       VALUES ($1, $2, 'ER↔Ward gate', $3, $4, $4, $5, 'internal', 'configured', 'active', 'unknown')`,
      [internalReaderId, clinic, GW_INT, roomER, roomWard],
    );

    // A reader that belongs to a DIFFERENT clinic — its gateway must be rejected cross-clinic.
    const otherRoom = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'Other-ER', 'stale', now(), now())`,
      [otherRoom, otherClinic],
    );
    await probePool!.query(
      `INSERT INTO vt_rfid_readers
         (id, clinic_id, name, gateway_code, room_id, from_room_id, to_room_id, gate_type, provisioning_state, status, reader_health_status)
       VALUES ($1, $2, 'Other gate', $3, $4, $4, NULL, 'boundary', 'configured', 'active', 'unknown')`,
      [randomUUID(), otherClinic, GW_OTHER, otherRoom],
    );

    equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, rfid_tag_epc, custody_state, checked_out_by_id, usage_state, readiness_state, version)
       VALUES ($1, $2, 'Ventilator E2E', 'needs_attention', $3, 'checked_out', $4, 'available', 'unknown', 1)`,
      [equipmentId, clinic, tagEpc, CHECKED_OUT_BY],
    );

    // Provision the HMAC secret (plaintext passthrough when DB_CONFIG_ENCRYPTION_KEY unset) and
    // enable ingest — this is the self-serve path the console drives (R-M1.1c).
    await storeCredentials(clinic, "rfid", { webhook_secret: SECRET });
    await setRfidIngestEnabled(clinic, true);
    __resetRfidConfigCacheForTests();
  });

  afterAll(async () => {
    try {
      for (const c of [clinic, otherClinic]) {
        for (const table of [
          "vt_rfid_egress_signals",
          "vt_equipment_rfid_reads",
          "vt_event_outbox",
          "vt_rfid_readers",
          "vt_equipment",
          "vt_rooms",
          "vt_server_config",
        ]) {
          const col = table === "vt_server_config" ? "key" : "clinic_id";
          if (col === "key") {
            await probePool!.query(`DELETE FROM ${table} WHERE key LIKE $1`, [`${c}:%`]);
            await probePool!.query(`DELETE FROM ${table} WHERE key LIKE $1`, [`rfid.ingest_enabled.${c}%`]);
          } else {
            await probePool!.query(`DELETE FROM ${table} WHERE clinic_id = $1`, [c]);
          }
        }
        await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [c]);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await probePool?.end();
      await db.$client.end?.();
    }
  });

  async function loadEquipment() {
    const [row] = await db
      .select({
        lastRfidRoomId: equipment.lastRfidRoomId,
        lastRfidGatewayCode: equipment.lastRfidGatewayCode,
        custodyState: equipment.custodyState,
        checkedOutById: equipment.checkedOutById,
      })
      .from(equipment)
      .where(eq(equipment.id, equipmentId));
    return row!;
  }

  async function countOfflineOutbox() {
    const rows = await db
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinic), eq(eventOutbox.type, RFID_READER_OFFLINE_EVENT)));
    return rows.length;
  }

  it("(1) a signed directional batch resolves last-seen to the DESTINATION room + direction; custody untouched", async () => {
    const res = await postBatch(clinic, {
      batchId: `e2e-dir-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_INT, readAt: "2026-07-17T08:00:00.000Z", direction: "exited" }],
    });

    expect(res.status).toBe(202);
    expect(res.json.ok).toBe(true);
    expect(res.json.directionalResolved).toBe(1);

    // Destination room = Ward (exited ER → Ward).
    const eqRow = await loadEquipment();
    expect(eqRow.lastRfidRoomId).toBe(roomWard);
    expect(eqRow.lastRfidGatewayCode).toBe(GW_INT);

    // Direction persisted on the reads row: from ER → to Ward.
    const [read] = await db
      .select({ fromRoomId: equipmentRfidReads.fromRoomId, toRoomId: equipmentRfidReads.toRoomId })
      .from(equipmentRfidReads)
      .where(and(eq(equipmentRfidReads.clinicId, clinic), eq(equipmentRfidReads.equipmentId, equipmentId)));
    expect(read?.fromRoomId).toBe(roomER);
    expect(read?.toRoomId).toBe(roomWard);

    // FROZEN guardrail: RFID never mutates custody.
    expect(eqRow.custodyState).toBe("checked_out");
    expect(eqRow.checkedOutById).toBe(CHECKED_OUT_BY);
  });

  it("(2) surfaces on the board snapshot AND the equipment-list projection (no offline alert from ingestion alone)", async () => {
    const snapshot = await buildCommandBoardSnapshot({ clinicId: clinic });
    const unit = snapshot.criticalUnits.find((u) => u.equipmentId === equipmentId);
    expect(unit).toBeDefined();
    expect(unit!.rfid?.locationId).toBe(roomWard);
    expect(unit!.rfid?.locationName).toBe("Ward");
    expect(unit!.rfid?.locationKind).toBe("room");
    expect(unit!.rfid?.readerId).toBe(internalReaderId);
    // Human room stays authoritative — RFID evidence never becomes the resolved location.
    expect(unit!.locationName).toBeUndefined();

    // Ingestion alone must NOT flip a reader offline (that requires the sweep past staleness).
    expect(snapshot.alerts.map((a) => a.type)).not.toContain("rfid_reader_offline");

    // Equipment-list RFID projection surfaces last-seen room + direction origin.
    const [listRow] = await db
      .select({ id: equipment.id, ...equipmentRfidSelect(clinic) })
      .from(equipment)
      .where(eq(equipment.id, equipmentId));
    expect(listRow?.lastRfidRoomName).toBe("Ward");
    expect(listRow?.lastRfidFromRoomName).toBe("ER");
  });

  it("(3) an OFFLINE reader raises the board alert — the sweep forces healthy→offline (ingestion alone never does)", async () => {
    const now = new Date();
    // The accepted ingest batch already set a fresh reader heartbeat. First sweep: unknown→healthy.
    await runRfidReaderOfflineSweep(now);
    const offlineBaseline = await countOfflineOutbox();

    // Board still healthy after a healthy sweep — no offline alert yet.
    let snapshot = await buildCommandBoardSnapshot({ clinicId: clinic });
    expect(snapshot.alerts.map((a) => a.type)).not.toContain("rfid_reader_offline");

    // Advance time past the staleness threshold, then sweep → healthy→offline (exactly one signal).
    await db
      .update(rfidReaders)
      .set({ lastReaderHeartbeatAt: new Date(now.getTime() - OFFLINE_AGE_MS) })
      .where(and(eq(rfidReaders.clinicId, clinic), eq(rfidReaders.id, internalReaderId)));
    await runRfidReaderOfflineSweep(now);
    expect(await countOfflineOutbox()).toBe(offlineBaseline + 1);

    // Now the board surfaces the offline alert for the unit whose last reader went offline.
    snapshot = await buildCommandBoardSnapshot({ clinicId: clinic });
    const offlineAlerts = snapshot.alerts.filter(
      (a) => a.type === "rfid_reader_offline" && a.equipmentId === equipmentId,
    );
    expect(offlineAlerts).toHaveLength(1);

    // Guardrail: the whole offline path never touched custody.
    const eqRow = await loadEquipment();
    expect(eqRow.custodyState).toBe("checked_out");
    expect(eqRow.checkedOutById).toBe(CHECKED_OUT_BY);
  });

  it("(negative) a cross-clinic reader gateway is rejected (422) and mutates nothing", async () => {
    const before = await loadEquipment();
    const res = await postBatch(clinic, {
      batchId: `e2e-xclinic-${randomUUID().slice(0, 6)}`,
      // GW_OTHER is a managed reader in `otherClinic`, NOT in `clinic` — must be UNKNOWN here.
      events: [{ tagEpc, gatewayCode: GW_OTHER, readAt: "2026-07-17T08:10:00.000Z", direction: "exited" }],
    });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("UNKNOWN_GATEWAY");

    // Batch rolled back — last-seen unchanged, custody untouched.
    const after = await loadEquipment();
    expect(after.lastRfidRoomId).toBe(before.lastRfidRoomId);
    expect(after.custodyState).toBe("checked_out");
    expect(after.checkedOutById).toBe(CHECKED_OUT_BY);
  });

  it("(negative) partial gateway coverage degrades to LAST-KNOWN (no unresolved/unknown regression)", async () => {
    const before = await loadEquipment();
    expect(before.lastRfidRoomId).toBe(roomWard); // last-known from the directional read

    // A legacy (non-directional) read at an UNMAPPED gateway: no room resolves for it.
    const res = await postBatch(clinic, {
      batchId: `e2e-partial-${randomUUID().slice(0, 6)}`,
      events: [{ tagEpc, gatewayCode: GW_NOWHERE, readAt: "2026-07-17T09:00:00.000Z" }],
    });
    expect(res.status).toBe(202);
    expect(res.json.unknownGateway).toBe(1);
    expect(res.json.updated).toBe(0);

    // Degrades to last-known Ward — NOT wiped to null / "unresolved".
    const after = await loadEquipment();
    expect(after.lastRfidRoomId).toBe(roomWard);

    const snapshot = await buildCommandBoardSnapshot({ clinicId: clinic });
    const unit = snapshot.criticalUnits.find((u) => u.equipmentId === equipmentId);
    expect(unit!.rfid?.locationKind).toBe("room");
    expect(unit!.rfid?.locationId).toBe(roomWard);

    // Guardrail once more.
    expect(after.custodyState).toBe("checked_out");
    expect(after.checkedOutById).toBe(CHECKED_OUT_BY);
  });
});
