/**
 * Docking P2 T2.5 (server) — citizen-anchor + not-found-here — Postgres
 * integration tests.
 *
 * Covers:
 *  - POST /api/docking/equipment/:id/citizen-anchor: a resting item with a
 *    resolvable home dock gets a new open anchor (source:"citizen") at that
 *    dock; a checked-out item or an item with no resolvable home dock is
 *    rejected with 409 errors.docking.noHomeStation.
 *  - POST /api/docking/equipment/:id/not-found-here: contradicts (invalidates)
 *    the item's current open anchor with reason "not_found_here"; idempotent
 *    no-op when no open anchor exists.
 *
 * Requires DATABASE_URL and migrations 164 (docks room/asset_type/capacity)
 * + 165 (vt_equipment_anchors).
 * Run: pnpm test tests/docking-citizen-anchor.integration.test.ts
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
const { logAudit } = (await import("../server/lib/audit.js")) as unknown as { logAudit: ReturnType<typeof vi.fn> };
const { createAnchor, getCurrentAnchor } = await import("../server/services/equipment-anchor.service.js");
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

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

async function api(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
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

async function seedDock(dockId: string, clinicId: string, roomId: string, assetTypeId: string) {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name, room_id, asset_type_id, capacity)
     VALUES ($1, $2, $3, $4, $5, 4) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, `Dock ${dockId.slice(0, 8)}`, roomId, assetTypeId],
  );
}

async function seedEquipment(
  eqId: string,
  clinicId: string,
  overrides: {
    homeRoomId?: string | null;
    assetTypeId?: string | null;
    custodyState?: string;
  } = {},
) {
  await probePool!.query(
    `INSERT INTO vt_equipment (id, clinic_id, name, status, version, home_room_id, asset_type_id, custody_state)
     VALUES ($1, $2, $3, 'ok', 1, $4, $5, $6)`,
    [
      eqId,
      clinicId,
      "Citizen Anchor Test Pump",
      overrides.homeRoomId ?? null,
      overrides.assetTypeId ?? null,
      overrides.custodyState ?? "returned",
    ],
  );
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

interface Ctx {
  clinicId: string;
  userId: string;
  roomId: string;
  assetTypeId: string;
  dockId: string;
}

let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("docking citizen-anchor + not-found-here (T2.5) integration", () => {
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
    await seedDock(ctx.dockId, ctx.clinicId, ctx.roomId, ctx.assetTypeId);
    logAudit.mockClear();
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await probePool!.query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  describe("citizen-anchor", () => {
    it("creates a citizen anchor at the item's home dock for a resting item", async () => {
      const eqId = randomUUID();
      await seedEquipment(eqId, ctx.clinicId, {
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "returned",
      });

      const res = await api(`/api/docking/equipment/${eqId}/citizen-anchor`, "POST");

      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "source")).toBe("citizen");
      expect(getString(res.json, "equipmentId")).toBe(eqId);
      expect(getString(res.json, "dockId")).toBe(ctx.dockId);
      expect(getString(res.json, "roomId")).toBe(ctx.roomId);

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).not.toBeNull();
      expect(current?.source).toBe("citizen");
      expect(current?.dockId).toBe(ctx.dockId);
      expect(current?.invalidatedAt).toBeNull();

      expect(logAudit).toHaveBeenCalledTimes(1);
      const call = logAudit.mock.calls[0]?.[0] as unknown;
      expect(isRecord(call)).toBe(true);
      if (!isRecord(call)) throw new Error("Expected logAudit call arg to be an object");
      expect(call.actionType).toBe("equipment_anchor_created");
      expect(call.targetId).toBe(eqId);
    });

    it("rejects a checked-out item with 409 errors.docking.noHomeStation", async () => {
      const eqId = randomUUID();
      await seedEquipment(eqId, ctx.clinicId, {
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "checked_out",
      });

      const res = await api(`/api/docking/equipment/${eqId}/citizen-anchor`, "POST");

      expect(res.status).toBe(409);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "code")).toBe("errors.docking.noHomeStation");

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it("rejects a resting item with no resolvable home dock (missing home assignment) with 409", async () => {
      const eqId = randomUUID();
      await seedEquipment(eqId, ctx.clinicId, { custodyState: "returned" });

      const res = await api(`/api/docking/equipment/${eqId}/citizen-anchor`, "POST");

      expect(res.status).toBe(409);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "code")).toBe("errors.docking.noHomeStation");

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
    });

    it("rejects a resting item homed to a (room, category) with no dock with 409", async () => {
      const eqId = randomUUID();
      const otherAssetTypeId = randomUUID();
      await seedAssetType(otherAssetTypeId, ctx.clinicId, "No-Dock Category");
      await seedEquipment(eqId, ctx.clinicId, {
        homeRoomId: ctx.roomId,
        assetTypeId: otherAssetTypeId,
        custodyState: "returned",
      });

      const res = await api(`/api/docking/equipment/${eqId}/citizen-anchor`, "POST");

      expect(res.status).toBe(409);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "code")).toBe("errors.docking.noHomeStation");
    });
  });

  describe("not-found-here", () => {
    it("invalidates the current anchor with reason=not_found_here", async () => {
      const eqId = randomUUID();
      await seedEquipment(eqId, ctx.clinicId, {
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "returned",
      });

      const anchor = await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: eqId,
        dockId: ctx.dockId,
        roomId: ctx.roomId,
        source: "citizen",
      });
      expect(anchor.invalidatedAt).toBeNull();

      logAudit.mockClear();
      const res = await api(`/api/docking/equipment/${eqId}/not-found-here`, "POST");

      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(res.json).toEqual({ ok: true });

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();

      const { rows } = await probePool!.query<{ invalidated_reason: string | null }>(
        `SELECT invalidated_reason FROM vt_equipment_anchors WHERE id = $1`,
        [anchor.id],
      );
      expect(rows[0]?.invalidated_reason).toBe("not_found_here");

      expect(logAudit).toHaveBeenCalledTimes(1);
      const call = logAudit.mock.calls[0]?.[0] as unknown;
      expect(isRecord(call)).toBe(true);
      if (!isRecord(call)) throw new Error("Expected logAudit call arg to be an object");
      expect(call.actionType).toBe("equipment_anchor_contradicted");
      expect(call.targetId).toBe(eqId);
    });

    it("is idempotent — a no-op 200 when there is no open anchor", async () => {
      const eqId = randomUUID();
      await seedEquipment(eqId, ctx.clinicId, { custodyState: "returned" });

      const res = await api(`/api/docking/equipment/${eqId}/not-found-here`, "POST");

      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(res.json).toEqual({ ok: true });

      const current = await getCurrentAnchor(ctx.clinicId, eqId);
      expect(current).toBeNull();
    });
  });
});
