/**
 * R-M1.5 — scan-only golden verification.
 *
 * A clinic with `rfid.ingest_enabled=false` and NO reads / NO managed readers must produce a
 * board snapshot, an equipment-list projection, and a resolver output that are UNPERTURBED by
 * the R-M1 RFID feature — byte-for-byte identical before and after a (blocked) ingest attempt.
 *
 * This is the zero-regression proof for the pre-RFID (scan-only) path:
 *   - the Command Board producer contributes NO rfid block, NO evidenceConflict, and NO
 *     rfid-typed alert for a unit that RFID has never seen;
 *   - the equipment-list RFID projection columns are all NULL;
 *   - a signed batch POSTed while ingest is disabled is rejected (403) and mutates nothing, so
 *     the normalized snapshot is identical before/after.
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
import { eq } from "drizzle-orm";

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  resolveAuditActorRole: () => "system",
}));

import { db, equipment } from "../server/db.js";
import rfidRoutes from "../server/routes/rfid.js";
import { equipmentRfidSelect } from "../server/routes/equipment/equipment-rfid-select.js";
import {
  buildCommandBoardSnapshot,
  deriveUnitRfid,
  type BoardRfidReaderInfo,
} from "../server/services/equipment-command-board.service.js";
import { storeCredentials } from "../server/integrations/credential-manager.js";
import { setRfidIngestEnabled, __resetRfidConfigCacheForTests } from "../server/lib/rfid/config.js";
import type { EquipmentCommandBoardSnapshot } from "../shared/equipment-board.js";

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

const SECRET = `golden-secret-${randomUUID().slice(0, 8)}`;

const RFID_ALERT_TYPES = [
  "rfid_reader_offline",
  "rfid_location_conflict",
  "ambiguous_rfid_location",
  "possible_egress",
];

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

async function postRfid(body: Buffer, headers: Record<string, string>): Promise<number> {
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
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** A board snapshot with the volatile wall-clock field stripped, for byte-for-byte comparison. */
function normalize(snapshot: EquipmentCommandBoardSnapshot): string {
  const { generatedAt: _generatedAt, ...rest } = snapshot;
  return JSON.stringify(rest);
}

describeDb("R-M1.5 scan-only golden (ingest disabled, no reads)", () => {
  const clinic = `rfid-golden-${randomUUID().slice(0, 8)}`;
  const tagEpc = `EPC-${randomUUID().slice(0, 8)}`;
  let equipmentId: string;
  const GW = `GW-GOLDEN-${randomUUID().slice(0, 6)}`;

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

    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinic]);
    const roomId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_rooms (id, clinic_id, name, sync_status, created_at, updated_at)
       VALUES ($1, $2, 'Ward', 'stale', now(), now())`,
      [roomId, clinic],
    );
    // Equipment carries a tag but has NEVER been seen by RFID (all last_rfid* columns NULL) and
    // no managed reader exists — the pure scan-only state.
    equipmentId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status, room_id, rfid_tag_epc, custody_state, usage_state, readiness_state, version)
       VALUES ($1, $2, 'Scan-only Monitor', 'needs_attention', $3, $4, 'returned', 'available', 'unknown', 1)`,
      [equipmentId, clinic, roomId, tagEpc],
    );

    // Provision a secret so a POST clears HMAC, but leave ingest DISABLED (the gate under test).
    await storeCredentials(clinic, "rfid", { webhook_secret: SECRET });
    await setRfidIngestEnabled(clinic, false);
    __resetRfidConfigCacheForTests();
  });

  afterAll(async () => {
    try {
      for (const table of ["vt_equipment", "vt_rooms", "vt_event_outbox"]) {
        await probePool!.query(`DELETE FROM ${table} WHERE clinic_id = $1`, [clinic]);
      }
      await probePool!.query(`DELETE FROM vt_server_config WHERE key LIKE $1`, [`${clinic}:%`]);
      await probePool!.query(`DELETE FROM vt_server_config WHERE key LIKE $1`, [`rfid.ingest_enabled.${clinic}%`]);
      await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinic]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await probePool?.end();
      await db.$client.end?.();
    }
  });

  it("the board producer contributes NO rfid block, NO conflict, NO rfid-typed alert", async () => {
    const snapshot = await buildCommandBoardSnapshot({ clinicId: clinic });
    const unit = snapshot.criticalUnits.find((u) => u.equipmentId === equipmentId);
    expect(unit).toBeDefined();
    expect(unit!.rfid).toBeUndefined();
    expect(unit!.evidenceConflict).toBeUndefined();
    // Human-confirmed room stays the resolved location, untouched by RFID.
    expect(unit!.locationName).toBe("Ward");

    const alertTypes = snapshot.alerts.map((a) => a.type);
    for (const rfidType of RFID_ALERT_TYPES) {
      expect(alertTypes).not.toContain(rfidType);
    }
  });

  it("the equipment-list RFID projection columns are all NULL", async () => {
    const [row] = await db
      .select({ id: equipment.id, ...equipmentRfidSelect(clinic) })
      .from(equipment)
      .where(eq(equipment.id, equipmentId));
    expect(row?.lastRfidSeenAt).toBeNull();
    expect(row?.lastRfidRoomId).toBeNull();
    expect(row?.lastRfidRoomName).toBeNull();
    expect(row?.lastRfidFromRoomName).toBeNull();
    expect(row?.lastRfidGatewayCode).toBeNull();
  });

  it("the resolver (deriveUnitRfid) contributes nothing for a never-seen unit", () => {
    const emptyReaders = new Map<string, BoardRfidReaderInfo>();
    const derived = deriveUnitRfid(
      {
        equipmentId,
        displayName: "Scan-only Monitor",
        humanRoomId: null,
        lastRfidSeenAt: null,
        lastRfidRoomId: null,
        lastRfidRoomName: null,
        lastRfidGatewayCode: null,
        recentReads: [],
        latestEgressAt: null,
      },
      emptyReaders,
    );
    expect(derived.rfid).toBeUndefined();
    expect(derived.evidenceConflict).toBeUndefined();
    expect(derived.alerts).toHaveLength(0);
  });

  it("a blocked ingest attempt (ingest disabled) leaves the snapshot byte-for-byte identical", async () => {
    const before = normalize(await buildCommandBoardSnapshot({ clinicId: clinic }));

    // Sign a well-formed batch — HMAC passes, but ingest is disabled → 403, zero mutation.
    const body = Buffer.from(
      JSON.stringify({
        batchId: `golden-${randomUUID().slice(0, 6)}`,
        events: [{ tagEpc, gatewayCode: GW, readAt: "2026-07-17T10:00:00.000Z" }],
      }),
    );
    const status = await postRfid(body, {
      "content-type": "application/json",
      "x-vettrack-clinic": clinic,
      "x-vettrack-signature": sign(body, SECRET),
    });
    expect(status).toBe(403);

    const after = normalize(await buildCommandBoardSnapshot({ clinicId: clinic }));
    expect(after).toBe(before);
  });
});
