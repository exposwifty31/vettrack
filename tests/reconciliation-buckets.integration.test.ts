/**
 * Docking P3 T3.6a (server) — full 8-bucket reconciliation breakdown —
 * Postgres integration tests.
 *
 * Extends GET /api/docking/reconciliation from the P1 ownership-only
 * buckets (unassigned/noStation/byDock, still asserted in
 * docking-home-assign.integration.test.ts) to the full classifier-derived
 * breakdown: `counts` (all 8 ReconciliationBucket keys, 0-filled) and
 * `byBucket` (items grouped by bucket, enriched with homeDockId/Name +
 * homeRoomId). Legacy `unassigned`/`noStation`/`byDock` must keep working —
 * AdminHomeAssignmentPage still consumes them.
 *
 * Requires DATABASE_URL and migrations 164 (docks room/asset_type/capacity)
 * + 165 (vt_equipment_anchors).
 * Run: pnpm test tests/reconciliation-buckets.integration.test.ts
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";
import { i18nMiddleware } from "../lib/i18n/middleware.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;

let currentClinicId = "";
let currentUserId = "";
const currentUserRole = "admin";

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: currentUserId, email: "test@ops.local", role: currentUserRole };
    req.clinicId = currentClinicId;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const dockingRoutes = (await import("../server/routes/docking.js")).default;
const { createAnchor, invalidateCurrentAnchor } = await import("../server/services/equipment-anchor.service.js");
const { db } = await import("../server/db.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", i18nMiddleware);
  app.use("/api/docking", dockingRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function isArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const val = obj[key];
  return typeof val === "number" ? val : undefined;
}

async function api(path: string, method: "GET" | "POST" = "GET"): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" } });
  let json: unknown = {};
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(userId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status, preferred_locale)
     VALUES ($1, $2, $3, $4, $5, 'admin', 'active', 'en')
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, "Test Admin"],
  );
}

async function seedRoom(roomId: string, clinicId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_rooms (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [roomId, clinicId, name],
  );
}

async function seedAssetType(assetTypeId: string, clinicId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_asset_types (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [assetTypeId, clinicId, name],
  );
}

async function seedDock(dockId: string, clinicId: string, roomId: string, assetTypeId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name, room_id, asset_type_id, capacity)
     VALUES ($1, $2, $3, $4, $5, 4) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, name, roomId, assetTypeId],
  );
}

// Column identifiers can't be parameterized ($1, $2, ...) — allowlist the
// columns a test may seed so a future caller can't smuggle an arbitrary
// identifier into the query string.
const SEED_EQUIPMENT_ALLOWED_COLUMNS = new Set([
  "id",
  "clinic_id",
  "name",
  "status",
  "version",
  "home_room_id",
  "asset_type_id",
  "custody_state",
  "checked_out_by_id",
  "checked_out_by_email",
  "room_id",
  "last_rfid_room_id",
]);

async function seedEquipment(eqId: string, clinicId: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    id: eqId,
    clinic_id: clinicId,
    name: "Reconciliation Test Pump",
    status: "ok",
    version: 1,
  };
  const row = { ...defaults, ...overrides };
  for (const key of Object.keys(row)) {
    if (!SEED_EQUIPMENT_ALLOWED_COLUMNS.has(key)) throw new Error(`seedEquipment: unexpected column "${key}"`);
  }
  const keys = Object.keys(row).join(", ");
  const vals = Object.keys(row).map((_, i) => `$${i + 1}`).join(", ");
  await probePool!.query(`INSERT INTO vt_equipment (${keys}) VALUES (${vals})`, Object.values(row));
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_anchors WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

const ALL_BUCKETS = [
  "at_home",
  "checked_out",
  "returned_unverified",
  "returned_away",
  "misplaced_at_station",
  "missing",
  "unassigned",
  "no_station",
];

interface Ctx {
  clinicId: string;
  userId: string;
  roomId: string;
  assetTypeId: string;
  dockId: string;
}

let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("docking reconciliation full 8-bucket breakdown (T3.6a) integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL required");
    }

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

    try {
      await probePool.query("SELECT 1");
      const { rows } = await probePool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'vt_equipment_anchors'`,
      );
      if (rows.length !== 1) {
        throw new Error("vt_equipment_anchors table missing (migration 165 not applied?)");
      }
    } catch (err) {
      if (probePool) {
        await probePool.end();
        probePool = null;
      }
      throw new Error(`Database connection or schema validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const app = buildApp();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (probePool) {
      await probePool.end();
      probePool = null;
    }
  });

  beforeEach(async () => {
    ctx = {
      clinicId: randomUUID(),
      userId: randomUUID(),
      roomId: randomUUID(),
      assetTypeId: randomUUID(),
      dockId: randomUUID(),
    };
    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userId;
    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userId, ctx.clinicId);
    await seedRoom(ctx.roomId, ctx.clinicId, "ICU");
    await seedAssetType(ctx.assetTypeId, ctx.clinicId, "Infusion Pump");
    await seedDock(ctx.dockId, ctx.clinicId, ctx.roomId, ctx.assetTypeId, "ICU Pump Dock");
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await probePool!.query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  it("counts.at_home reflects a homed+categorized item anchored at its home dock; byBucket.at_home is trimmed to counts-only (M-5, phase review)", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
    });
    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: eqId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      source: "citizen",
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");
    expect(getNumber(counts, "at_home")).toBe(1);

    // M-5: at_home is potentially the whole fleet and the client only
    // renders its count — byBucket.at_home is trimmed to an empty array.
    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    const atHome = byBucket.at_home;
    expect(isArray(atHome)).toBe(true);
    if (!isArray(atHome)) throw new Error("Expected byBucket.at_home to be an array");
    expect(atHome.length).toBe(0);
  });

  it("counts.checked_out reflects a checked-out item — never counted as missing, regardless of anchor history; byBucket.checked_out is trimmed to counts-only (M-5, phase review)", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "checked_out",
      checked_out_by_id: ctx.userId,
      checked_out_by_email: "holder@ops.local",
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");
    expect(getNumber(counts, "checked_out")).toBe(1);
    expect(getNumber(counts, "missing")).toBe(0);

    // M-5: checked_out is potentially the whole fleet — byBucket.checked_out
    // is trimmed to an empty array; counts is still the source of truth.
    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    const checkedOut = byBucket.checked_out;
    expect(isArray(checkedOut)).toBe(true);
    if (!isArray(checkedOut)) throw new Error("Expected byBucket.checked_out to be an array");
    expect(checkedOut.length).toBe(0);

    const missing = byBucket.missing;
    expect(isArray(missing)).toBe(true);
    if (!isArray(missing)) throw new Error("Expected byBucket.missing to be an array");
    expect(missing.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(false);
  });

  it("byBucket.missing includes a homed item whose latest anchor was invalidated by sweep_missing, presence not outside home", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
      // room_id / last_rfid_room_id left NULL — presence is not outside home.
    });

    // D-13: invalidateCurrentAnchor is a no-op with nothing open, so give
    // the item a prior open anchor first, then contradict it.
    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: eqId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      source: "citizen",
    });
    await invalidateCurrentAnchor(db, { clinicId: ctx.clinicId, equipmentId: eqId, reason: "sweep_missing" });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");
    expect(getNumber(counts, "missing")).toBe(1);

    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    const missing = byBucket.missing;
    expect(isArray(missing)).toBe(true);
    if (!isArray(missing)) throw new Error("Expected byBucket.missing to be an array");
    expect(missing.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(true);
  });

  it("byBucket.unassigned AND the legacy `unassigned` array both include an item with homeRoomId null", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId);

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const legacyUnassigned = res.json.unassigned;
    expect(isArray(legacyUnassigned)).toBe(true);
    if (!isArray(legacyUnassigned)) throw new Error("Expected legacy unassigned to be an array");
    expect(legacyUnassigned.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(true);

    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    const unassigned = byBucket.unassigned;
    expect(isArray(unassigned)).toBe(true);
    if (!isArray(unassigned)) throw new Error("Expected byBucket.unassigned to be an array");
    expect(unassigned.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(true);

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");
    expect(getNumber(counts, "unassigned")).toBe(1);
  });

  it("byBucket.no_station AND the legacy `noStation` array both include a homed item with no dock for its (room, category)", async () => {
    const noDockAssetTypeId = randomUUID();
    await seedAssetType(noDockAssetTypeId, ctx.clinicId, "No-Dock Category");
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: noDockAssetTypeId,
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const legacyNoStation = res.json.noStation;
    expect(isArray(legacyNoStation)).toBe(true);
    if (!isArray(legacyNoStation)) throw new Error("Expected legacy noStation to be an array");
    expect(legacyNoStation.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(true);

    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    const noStation = byBucket.no_station;
    expect(isArray(noStation)).toBe(true);
    if (!isArray(noStation)) throw new Error("Expected byBucket.no_station to be an array");
    expect(noStation.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(true);

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");
    expect(getNumber(counts, "no_station")).toBe(1);
  });

  it("counts sums to the number of (non-deleted) items; every bucket key is present (0 where empty)", async () => {
    const atHomeId = randomUUID();
    const checkedOutId = randomUUID();
    const missingId = randomUUID();
    const unassignedId = randomUUID();
    const noStationAssetTypeId = randomUUID();
    const noStationId = randomUUID();

    await seedAssetType(noStationAssetTypeId, ctx.clinicId, "No-Dock Category");

    await seedEquipment(atHomeId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
    });
    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: atHomeId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      source: "citizen",
    });

    await seedEquipment(checkedOutId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "checked_out",
      checked_out_by_id: ctx.userId,
      checked_out_by_email: "holder@ops.local",
    });

    await seedEquipment(missingId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
    });
    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: missingId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      source: "citizen",
    });
    await invalidateCurrentAnchor(db, { clinicId: ctx.clinicId, equipmentId: missingId, reason: "sweep_missing" });

    await seedEquipment(unassignedId, ctx.clinicId);

    await seedEquipment(noStationId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: noStationAssetTypeId,
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");

    // Every bucket key present.
    expect(Object.keys(counts).sort()).toEqual([...ALL_BUCKETS].sort());

    const total = Object.values(counts).reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
    expect(total).toBe(5);

    expect(getNumber(counts, "at_home")).toBe(1);
    expect(getNumber(counts, "checked_out")).toBe(1);
    expect(getNumber(counts, "missing")).toBe(1);
    expect(getNumber(counts, "unassigned")).toBe(1);
    expect(getNumber(counts, "no_station")).toBe(1);
    // Unused buckets are 0-filled, not absent.
    expect(getNumber(counts, "returned_unverified")).toBe(0);
    expect(getNumber(counts, "returned_away")).toBe(0);
    expect(getNumber(counts, "misplaced_at_station")).toBe(0);

    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    expect(Object.keys(byBucket).sort()).toEqual([...ALL_BUCKETS].sort());
    for (const bucket of ALL_BUCKETS) {
      expect(isArray(byBucket[bucket])).toBe(true);
    }
  });

  it("S2-13: counts.returned_away === 1 for a homed item with room_id set to a non-home room and no anchor (roomId presence fallback)", async () => {
    const otherRoomId = randomUUID();
    await seedRoom(otherRoomId, ctx.clinicId, "Ward");
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
      room_id: otherRoomId, // presence elsewhere, lastRfidRoomId left NULL — exercises the `?? item.roomId` fallback
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    const counts = res.json.counts;
    expect(isRecord(counts)).toBe(true);
    if (!isRecord(counts)) throw new Error("Expected counts to be an object");
    expect(getNumber(counts, "returned_away")).toBe(1);

    const byBucket = res.json.byBucket;
    expect(isRecord(byBucket)).toBe(true);
    if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
    const returnedAway = byBucket.returned_away;
    expect(isArray(returnedAway)).toBe(true);
    if (!isArray(returnedAway)) throw new Error("Expected byBucket.returned_away to be an array");
    expect(returnedAway.some((e) => isRecord(e) && getString(e, "id") === eqId)).toBe(true);
  });

  it("reconciliation full breakdown is clinic-scoped — another clinic's items never appear in counts/byBucket", async () => {
    const otherClinicId = randomUUID();
    const otherRoomId = randomUUID();
    const otherAssetTypeId = randomUUID();
    const otherEqId = randomUUID();
    await seedClinic(otherClinicId);
    await seedUser(randomUUID(), otherClinicId);
    await seedRoom(otherRoomId, otherClinicId, "Other Room");
    await seedAssetType(otherAssetTypeId, otherClinicId, "Other Type");
    await seedEquipment(otherEqId, otherClinicId, {
      home_room_id: otherRoomId,
      asset_type_id: otherAssetTypeId,
    });

    try {
      const res = await api(`/api/docking/reconciliation`, "GET");
      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");

      const counts = res.json.counts;
      expect(isRecord(counts)).toBe(true);
      if (!isRecord(counts)) throw new Error("Expected counts to be an object");
      const total = Object.values(counts).reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
      expect(total).toBe(0);

      const byBucket = res.json.byBucket;
      expect(isRecord(byBucket)).toBe(true);
      if (!isRecord(byBucket)) throw new Error("Expected byBucket to be an object");
      for (const bucket of ALL_BUCKETS) {
        const arr = byBucket[bucket];
        expect(isArray(arr)).toBe(true);
        if (!isArray(arr)) throw new Error(`Expected byBucket.${bucket} to be an array`);
        expect(arr.some((e) => isRecord(e) && getString(e, "id") === otherEqId)).toBe(false);
      }
    } finally {
      await purgeClinic(otherClinicId);
    }
  });
});
