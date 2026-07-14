/**
 * Dock-return writes a return_toggle anchor (docking P2, T2.4) — Postgres
 * integration test.
 *
 * The dock-return route (POST /equipment/:equipmentId/dock-return) is an
 * accountable at-station assertion: reaching the "docked" transition must
 * also create an equipment anchor (source: "return_toggle") in the SAME
 * transaction, so a rolled-back return leaves no anchor.
 *
 * Requires DATABASE_URL and migration 165 (vt_equipment_anchors) applied.
 * Run: pnpm test tests/dock-return-anchor.integration.test.ts
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
const currentUserRole = "vet";

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

const opsRoutes = (await import("../server/routes/equipment-operational-state.js")).default;
const { getCurrentAnchor } = await import("../server/services/equipment-anchor.service.js");
const pgResult = await import("../server/lib/pg-result.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", i18nMiddleware);
  app.use("/api", opsRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

async function api(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
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
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status)
     VALUES ($1, $2, $3, $4, $5, 'vet', 'active') ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `u_${randomUUID()}@ops.local`, "Test Vet"],
  );
}

async function seedRoom(roomId: string, clinicId: string, name = "ICU") {
  await probePool!.query(
    `INSERT INTO vt_rooms (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [roomId, clinicId, name],
  );
}

async function seedAssetType(atId: string, clinicId: string, name = "Infusion Pump") {
  await probePool!.query(
    `INSERT INTO vt_asset_types (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [atId, clinicId, name],
  );
}

async function seedDock(dockId: string, clinicId: string, name = "Dock A", roomId: string | null = null) {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name, room_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, name, roomId],
  );
}

async function seedEquipment(eqId: string, clinicId: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    id: eqId,
    clinic_id: clinicId,
    name: "Test Pump",
    status: "ok",
    custody_state: "returned",
    usage_state: "available",
    readiness_state: "unknown",
    version: 1,
    asset_type_id: null,
    dock_id: null,
    room_id: null,
  };
  const row = { ...defaults, ...overrides };
  const keys = Object.keys(row).join(", ");
  const vals = Object.keys(row).map((_, i) => `$${i + 1}`).join(", ");
  await probePool!.query(
    `INSERT INTO vt_equipment (${keys}) VALUES (${vals}) ON CONFLICT DO NOTHING`,
    Object.values(row),
  );
}

async function readEquipment(eqId: string) {
  const { rows } = await probePool!.query<Record<string, unknown>>(
    `SELECT * FROM vt_equipment WHERE id = $1`,
    [eqId],
  );
  return rows[0] ?? null;
}

async function countAnchors(clinicId: string, equipmentId: string): Promise<number> {
  const { rows } = await probePool!.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM vt_equipment_anchors WHERE clinic_id = $1 AND equipment_id = $2`,
    [clinicId, equipmentId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_anchors WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_event_outbox WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_unit_condition_states WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_staging_queue WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_type_conditions WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

interface Ctx {
  clinicId: string;
  userId: string;
  roomId: string;
  assetTypeId: string;
  dockId: string;
  eqId: string;
}

let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("dock-return writes a return_toggle anchor (T2.4)", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL required");
    }

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

    try {
      await probePool.query("SELECT 1");
      const { rows: anchorTable } = await probePool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'vt_equipment_anchors'`,
      );
      if (anchorTable.length !== 1) {
        throw new Error("Database schema validation failed: vt_equipment_anchors missing (migration 165 not applied?)");
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
      eqId: randomUUID(),
    };
    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userId;
    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userId, ctx.clinicId);
    await seedRoom(ctx.roomId, ctx.clinicId);
    await seedAssetType(ctx.assetTypeId, ctx.clinicId);
    await seedDock(ctx.dockId, ctx.clinicId);
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("dock-return creates an OPEN return_toggle anchor for the returned dock/asserter", async () => {
    await seedEquipment(ctx.eqId, ctx.clinicId, {
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
      room_id: ctx.roomId,
    });

    const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
      dockId: ctx.dockId,
      conditionVerifications: [],
    });

    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");
    expect(res.json.custodyState).toBe("docked");

    const anchor = await getCurrentAnchor(ctx.clinicId, ctx.eqId);
    expect(anchor).not.toBeNull();
    expect(anchor?.source).toBe("return_toggle");
    expect(anchor?.dockId).toBe(ctx.dockId);
    expect(anchor?.assertedById).toBe(ctx.userId);
    expect(anchor?.roomId).toBe(ctx.roomId);
    expect(anchor?.invalidatedAt).toBeNull();
  });

  it("#7 (P2 review) — anchor roomId is the DOCK's room, not the equipment's assigned room, when they diverge", async () => {
    const dockRoomId = randomUUID();
    await seedRoom(dockRoomId, ctx.clinicId, "Surgery Suite");
    const dockInAnotherRoom = randomUUID();
    await seedDock(dockInAnotherRoom, ctx.clinicId, "Dock In Surgery", dockRoomId);

    // Equipment is administratively homed to ctx.roomId, but returns to a
    // dock physically located in a DIFFERENT room (dockRoomId).
    await seedEquipment(ctx.eqId, ctx.clinicId, {
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
      room_id: ctx.roomId,
    });

    const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
      dockId: dockInAnotherRoom,
      conditionVerifications: [],
    });

    expect(res.status).toBe(200);
    const anchor = await getCurrentAnchor(ctx.clinicId, ctx.eqId);
    expect(anchor?.dockId).toBe(dockInAnotherRoom);
    expect(anchor?.roomId).toBe(dockRoomId);
    expect(anchor?.roomId).not.toBe(ctx.roomId);
  });

  it("dock-return superseded a prior open anchor for the same item (only one open anchor at a time)", async () => {
    await seedEquipment(ctx.eqId, ctx.clinicId, {
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
    });

    // First dock-return opens an anchor.
    const firstRes = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
      dockId: ctx.dockId,
      conditionVerifications: [],
    });
    expect(firstRes.status).toBe(200);
    const firstAnchor = await getCurrentAnchor(ctx.clinicId, ctx.eqId);
    expect(firstAnchor).not.toBeNull();

    // Simulate a second dock-return cycle (custody flips back to returned then docked again).
    await probePool!.query(`UPDATE vt_equipment SET custody_state = 'returned' WHERE id = $1`, [ctx.eqId]);
    const secondDockId = randomUUID();
    await seedDock(secondDockId, ctx.clinicId, "Dock B");

    const secondRes = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
      dockId: secondDockId,
      conditionVerifications: [],
    });
    expect(secondRes.status).toBe(200);

    const openAnchorsCount = await probePool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vt_equipment_anchors WHERE clinic_id = $1 AND equipment_id = $2 AND invalidated_at IS NULL`,
      [ctx.clinicId, ctx.eqId],
    );
    expect(Number(openAnchorsCount.rows[0]?.count ?? 0)).toBe(1);

    const currentAnchor = await getCurrentAnchor(ctx.clinicId, ctx.eqId);
    expect(currentAnchor?.dockId).toBe(secondDockId);

    const totalAnchors = await countAnchors(ctx.clinicId, ctx.eqId);
    expect(totalAnchors).toBe(2);
  });

  it("a failed dock-return (version conflict) writes no anchor — atomic with the docked transition", async () => {
    await seedEquipment(ctx.eqId, ctx.clinicId, {
      asset_type_id: ctx.assetTypeId,
      custody_state: "returned",
      version: 1,
    });

    // Force the transaction's optimistic-lock UPDATE to report zero rows matched,
    // the same way the existing dock-return version-conflict test does.
    const spy = vi
      .spyOn(pgResult, "pgUpdateMatchedZeroRows")
      .mockImplementation((result) => {
        if (spy.mock.calls.length === 1) return true;
        return pgResult.pgUpdateMatchedZeroRows(result);
      });

    try {
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [],
      });

      expect(res.status).toBe(409);

      const eq = await readEquipment(ctx.eqId);
      expect(eq?.custody_state).toBe("returned");

      const anchor = await getCurrentAnchor(ctx.clinicId, ctx.eqId);
      expect(anchor).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
