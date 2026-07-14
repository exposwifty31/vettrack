/**
 * Docking route (T1.3) — Postgres integration tests.
 *
 * Covers POST/GET /docks: category (assetTypeId) + capacity persistence,
 * one-station-per-(clinic, room, category) 409 via the DB unique index
 * (vt_docks_clinic_room_assettype_uq, migration 164), and assetTypeName
 * on list.
 *
 * Requires DATABASE_URL and migration 164 (docks.asset_type_id/capacity).
 * Run: pnpm test tests/docking-route.integration.test.ts
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
let currentUserRole = "admin";

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

async function api(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
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

async function purgeClinic(clinicId: string) {
  const P = probePool!;
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

describe.skipIf(!DATABASE_URL)("docking route integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL required");
    }

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

    try {
      await probePool.query("SELECT 1");

      const { rows: assetTypeCol } = await probePool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='vt_docks' AND column_name='asset_type_id'`,
      );
      const { rows: capacityCol } = await probePool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='vt_docks' AND column_name='capacity'`,
      );
      const { rows: uniqueIdx } = await probePool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename='vt_docks' AND indexname='vt_docks_clinic_room_assettype_uq'`,
      );

      if (assetTypeCol.length !== 1 || capacityCol.length !== 1 || uniqueIdx.length !== 1) {
        throw new Error("Database schema validation failed: missing required columns or indexes");
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

  it("creates a dock with category + capacity persisted", async () => {
    const res = await api("/api/docks", "POST", {
      name: "Pump Station A",
      roomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      capacity: 4,
    });

    expect(res.status).toBe(201);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("Expected response to be an object");

    expect(getString(res.json, "assetTypeId")).toBe(ctx.assetTypeId);
    expect(getNumber(res.json, "capacity")).toBe(4);

    const dockId = getString(res.json, "id");
    expect(dockId).toBeDefined();

    const { rows } = await probePool!.query<{ asset_type_id: string; capacity: number }>(
      `SELECT asset_type_id, capacity FROM vt_docks WHERE id = $1`,
      [dockId],
    );
    expect(rows[0]?.asset_type_id).toBe(ctx.assetTypeId);
    expect(rows[0]?.capacity).toBe(4);
  });

  it("rejects a second station for the same (room, category) with 409", async () => {
    const first = await api("/api/docks", "POST", {
      name: "Pump Station A",
      roomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      capacity: 4,
    });
    expect(first.status).toBe(201);

    const second = await api("/api/docks", "POST", {
      name: "Pump Station B",
      roomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      capacity: 2,
    });

    expect(second.status).toBe(409);
    expect(isRecord(second.json)).toBe(true);
    if (!isRecord(second.json)) throw new Error("Expected response to be an object");
    expect(getString(second.json, "code")).toBe("errors.docking.duplicateStation");
  });

  it("rejects a second dock with a duplicate name (distinct room/category) as 409 duplicateName", async () => {
    const first = await api("/api/docks", "POST", {
      name: "Shared Dock Name",
      roomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      capacity: 4,
    });
    expect(first.status).toBe(201);

    // Different room AND different category → the (room, category) index cannot
    // fire, so a 409 here is attributable only to the name unique constraint.
    const otherRoomId = randomUUID();
    const otherAssetTypeId = randomUUID();
    await seedRoom(otherRoomId, ctx.clinicId, "Recovery");
    await seedAssetType(otherAssetTypeId, ctx.clinicId, "Monitor");

    const second = await api("/api/docks", "POST", {
      name: "Shared Dock Name",
      roomId: otherRoomId,
      assetTypeId: otherAssetTypeId,
      capacity: 2,
    });

    expect(second.status).toBe(409);
    expect(isRecord(second.json)).toBe(true);
    if (!isRecord(second.json)) throw new Error("Expected response to be an object");
    const code = getString(second.json, "code");
    expect(code).toBe("errors.docking.duplicateName");
    expect(code).not.toBe("errors.docking.duplicateStation");
  });

  it("includes assetTypeName and roomName on list (M1)", async () => {
    const created = await api("/api/docks", "POST", {
      name: "Pump Station A",
      roomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      capacity: 4,
    });
    expect(created.status).toBe(201);

    const list = await api("/api/docks", "GET");
    expect(list.status).toBe(200);
    expect(isArray(list.json)).toBe(true);
    if (!isArray(list.json)) throw new Error("Expected response to be an array");

    expect(isRecord(created.json)).toBe(true);
    if (!isRecord(created.json)) throw new Error("Expected created response to be an object");
    const createdId = getString(created.json, "id");

    const row = list.json.find((r) => isRecord(r) && getString(r, "id") === createdId);
    expect(row).toBeDefined();
    expect(isRecord(row)).toBe(true);
    if (!isRecord(row)) throw new Error("Expected row to be an object");
    expect(getString(row, "assetTypeName")).toBe("Infusion Pump");
    expect(getString(row, "roomName")).toBe("ICU");
  });
});
