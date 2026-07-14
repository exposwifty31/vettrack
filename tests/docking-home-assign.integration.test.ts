/**
 * Docking home-assignment + reconciliation (T1.4) — Postgres integration tests.
 *
 * Covers PATCH/POST home-assignment writes (single + bulk) and the
 * GET /api/docking/reconciliation read: unassigned bucket (homeRoomId or
 * assetTypeId missing), noStation bucket (both set but no dock exists for
 * that (room, category) pair via resolveHomeDock), and byDock expected fill.
 *
 * Requires DATABASE_URL and migration 164 (equipment.home_room_id,
 * docks.asset_type_id/capacity).
 * Run: pnpm test tests/docking-home-assign.integration.test.ts
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
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows: homeRoomCol } = await probePool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='vt_equipment' AND column_name='home_room_id'`,
    );
    const { rows: assetTypeCol } = await probePool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='vt_docks' AND column_name='asset_type_id'`,
    );
    const { rows: capacityCol } = await probePool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='vt_docks' AND column_name='capacity'`,
    );
    dbReachable = homeRoomCol.length === 1 && assetTypeCol.length === 1 && capacityCol.length === 1;
  } catch {
    dbReachable = false;
  }
}

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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", i18nMiddleware);
  app.use("/api/docking", dockingRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

type JsonObj = Record<string, unknown>;

async function api(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: JsonObj,
): Promise<{ status: number; json: JsonObj }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: JsonObj = {};
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as JsonObj;
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

async function seedDock(
  dockId: string,
  clinicId: string,
  roomId: string,
  assetTypeId: string,
  capacity = 4,
) {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name, room_id, asset_type_id, capacity)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, `Dock ${dockId.slice(0, 8)}`, roomId, assetTypeId, capacity],
  );
}

async function seedEquipment(eqId: string, clinicId: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    id: eqId,
    clinic_id: clinicId,
    name: "Test Pump",
    status: "ok",
    version: 1,
  };
  const row = { ...defaults, ...overrides };
  const keys = Object.keys(row).join(", ");
  const vals = Object.keys(row).map((_, i) => `$${i + 1}`).join(", ");
  await probePool!.query(`INSERT INTO vt_equipment (${keys}) VALUES (${vals})`, Object.values(row));
}

async function equipmentRow(
  eqId: string,
): Promise<{ home_room_id: string | null; asset_type_id: string | null; version: number } | null> {
  const { rows } = await probePool!.query<{
    home_room_id: string | null;
    asset_type_id: string | null;
    version: number;
  }>(`SELECT home_room_id, asset_type_id, version FROM vt_equipment WHERE id = $1`, [eqId]);
  return rows[0] ?? null;
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

interface Ctx {
  clinicId: string;
  userId: string;
  roomId: string;
  assetTypeId: string;
}

let ctx: Ctx;

describe.skipIf(!dbReachable)("docking home-assignment + reconciliation integration", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
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
    if (probePool) await probePool.end();
  });

  beforeEach(async () => {
    ctx = {
      clinicId: randomUUID(),
      userId: randomUUID(),
      roomId: randomUUID(),
      assetTypeId: randomUUID(),
    };
    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userId;
    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userId, ctx.clinicId);
    await seedRoom(ctx.roomId, ctx.clinicId, "ICU");
    await seedAssetType(ctx.assetTypeId, ctx.clinicId, "Infusion Pump");
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("PATCH assigns a home → the row's homeRoomId updates", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId);

    const res = await api(`/api/docking/equipment/${eqId}/home`, "PATCH", {
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
    });

    expect(res.status).toBe(200);
    expect(res.json.homeRoomId).toBe(ctx.roomId);
    expect(res.json.assetTypeId).toBe(ctx.assetTypeId);

    const row = await equipmentRow(eqId);
    expect(row?.home_room_id).toBe(ctx.roomId);
    expect(row?.asset_type_id).toBe(ctx.assetTypeId);
    expect(row?.version).toBe(2);
  });

  it("PATCH on a non-existent id in this clinic returns 404", async () => {
    const res = await api(`/api/docking/equipment/${randomUUID()}/home`, "PATCH", {
      homeRoomId: ctx.roomId,
    });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("errors.notFound");
  });

  it("bulk-assigns home to multiple ids in one call", async () => {
    const eqId1 = randomUUID();
    const eqId2 = randomUUID();
    await seedEquipment(eqId1, ctx.clinicId);
    await seedEquipment(eqId2, ctx.clinicId);

    const res = await api(`/api/docking/equipment/home/bulk`, "POST", {
      ids: [eqId1, eqId2],
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
    });

    expect(res.status).toBe(200);
    expect(res.json.updated).toBe(2);

    const row1 = await equipmentRow(eqId1);
    const row2 = await equipmentRow(eqId2);
    expect(row1?.home_room_id).toBe(ctx.roomId);
    expect(row2?.home_room_id).toBe(ctx.roomId);
  });

  it("reconciliation.unassigned includes an item with homeRoomId IS NULL", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId);

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    const unassigned = res.json.unassigned as Array<{ id: string }>;
    expect(unassigned.some((e) => e.id === eqId)).toBe(true);
  });

  it("reconciliation.noStation includes an item homed to a (room, category) with no dock", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    const noStation = res.json.noStation as Array<{ id: string }>;
    const unassigned = res.json.unassigned as Array<{ id: string }>;
    expect(noStation.some((e) => e.id === eqId)).toBe(true);
    expect(unassigned.some((e) => e.id === eqId)).toBe(false);
  });

  it("reconciliation.noStation excludes an item homed to a (room, category) that HAS a dock", async () => {
    const eqId = randomUUID();
    const dockId = randomUUID();
    await seedDock(dockId, ctx.clinicId, ctx.roomId, ctx.assetTypeId, 4);
    await seedEquipment(eqId, ctx.clinicId, {
      home_room_id: ctx.roomId,
      asset_type_id: ctx.assetTypeId,
    });

    const res = await api(`/api/docking/reconciliation`, "GET");
    expect(res.status).toBe(200);
    const noStation = res.json.noStation as Array<{ id: string }>;
    expect(noStation.some((e) => e.id === eqId)).toBe(false);

    const byDock = res.json.byDock as Array<{ dock: { id: string }; expectedFill: number; capacity: number }>;
    const entry = byDock.find((d) => d.dock.id === dockId);
    expect(entry).toBeDefined();
    expect(entry?.expectedFill).toBe(1);
    expect(entry?.capacity).toBe(4);
  });

  it("reconciliation is clinic-scoped — another clinic's items never appear", async () => {
    const otherClinicId = randomUUID();
    const otherRoomId = randomUUID();
    const otherAssetTypeId = randomUUID();
    const otherEqId = randomUUID();
    await seedClinic(otherClinicId);
    await seedUser(randomUUID(), otherClinicId);
    await seedRoom(otherRoomId, otherClinicId, "Other Room");
    await seedAssetType(otherAssetTypeId, otherClinicId, "Other Type");
    await seedEquipment(otherEqId, otherClinicId);

    try {
      const res = await api(`/api/docking/reconciliation`, "GET");
      expect(res.status).toBe(200);
      const unassigned = res.json.unassigned as Array<{ id: string }>;
      expect(unassigned.some((e) => e.id === otherEqId)).toBe(false);
    } finally {
      await purgeClinic(otherClinicId);
    }
  });
});
