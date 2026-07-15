/**
 * Docking P3 T3.2a (server) — Room Sweep expected-list (GET) + commit
 * (POST) — Postgres integration tests.
 *
 * Covers:
 *  - GET /api/docking/rooms/:roomId/sweep: returns every item HOMED to the
 *    room (resting + checked-out), each classified via
 *    classifyReconciliationBucket with its resolved home dock.
 *  - POST /api/docking/rooms/:roomId/sweep: in one transaction, confirmed
 *    resting items get a fresh source:"sweep" anchor at their home dock;
 *    unconfirmed expected-resting items are contradicted
 *    (reason:"sweep_missing"); checked-out items are never touched (D-9);
 *    stray/foreign confirmed ids are silently ignored, not errored.
 *
 * Requires DATABASE_URL and migrations 164 (docks room/asset_type/capacity)
 * + 165 (vt_equipment_anchors).
 * Run: pnpm test tests/room-sweep.integration.test.ts
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

async function seedDock(dockId: string, clinicId: string, roomId: string, assetTypeId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name, room_id, asset_type_id, capacity)
     VALUES ($1, $2, $3, $4, $5, 4) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, name, roomId, assetTypeId],
  );
}

async function seedEquipment(
  eqId: string,
  clinicId: string,
  overrides: {
    name?: string;
    homeRoomId?: string | null;
    assetTypeId?: string | null;
    custodyState?: string;
    checkedOutById?: string | null;
    checkedOutByEmail?: string | null;
  } = {},
) {
  await probePool!.query(
    `INSERT INTO vt_equipment
       (id, clinic_id, name, status, version, home_room_id, asset_type_id, custody_state, checked_out_by_id, checked_out_by_email)
     VALUES ($1, $2, $3, 'ok', 1, $4, $5, $6, $7, $8)`,
    [
      eqId,
      clinicId,
      overrides.name ?? "Room Sweep Test Pump",
      overrides.homeRoomId ?? null,
      overrides.assetTypeId ?? null,
      overrides.custodyState ?? "returned",
      overrides.checkedOutById ?? null,
      overrides.checkedOutByEmail ?? null,
    ],
  );
}

async function anchorCount(equipmentId: string): Promise<number> {
  const { rows } = await probePool!.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM vt_equipment_anchors WHERE equipment_id = $1`,
    [equipmentId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function lastInvalidatedReason(equipmentId: string): Promise<string | null> {
  const { rows } = await probePool!.query<{ invalidated_reason: string | null }>(
    `SELECT invalidated_reason FROM vt_equipment_anchors WHERE equipment_id = $1 ORDER BY asserted_at DESC LIMIT 1`,
    [equipmentId],
  );
  return rows[0]?.invalidated_reason ?? null;
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

describe.skipIf(!DATABASE_URL)("docking room sweep (T3.2a) integration", () => {
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
    logAudit.mockClear();
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await probePool!.query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  describe("GET /rooms/:roomId/sweep — expected list", () => {
    it("returns all items homed to the room, classified, with the checked-out one carrying a holder", async () => {
      const restingIds = [randomUUID(), randomUUID(), randomUUID()];
      const checkedOutId = randomUUID();

      for (const [i, id] of restingIds.entries()) {
        await seedEquipment(id, ctx.clinicId, {
          name: `Resting Pump ${i}`,
          homeRoomId: ctx.roomId,
          assetTypeId: ctx.assetTypeId,
          custodyState: "returned",
        });
      }
      await seedEquipment(checkedOutId, ctx.clinicId, {
        name: "Checked Out Pump",
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "checked_out",
        checkedOutById: ctx.userId,
        checkedOutByEmail: "holder@ops.local",
      });

      const res = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "GET");

      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "roomId")).toBe(ctx.roomId);
      const items = res.json.items as Array<Record<string, unknown>>;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBe(4);

      for (const id of restingIds) {
        const item = items.find((it) => it.id === id);
        expect(item).toBeDefined();
        expect(item!.homeDockId).toBe(ctx.dockId);
        expect(item!.homeDockName).toBe("ICU Pump Dock");
        expect(item!.bucket).toBe("returned_unverified");
        expect(item!.atStation).toBe(false);
        expect(item!.checkedOutById).toBeNull();
      }

      const checkedOutItem = items.find((it) => it.id === checkedOutId);
      expect(checkedOutItem).toBeDefined();
      expect(checkedOutItem!.bucket).toBe("checked_out");
      expect(checkedOutItem!.checkedOutById).toBe(ctx.userId);
      expect(checkedOutItem!.checkedOutByEmail).toBe("holder@ops.local");
    });

    it("404s errors.notFound for a room that doesn't exist in this clinic", async () => {
      const res = await api(`/api/docking/rooms/${randomUUID()}/sweep`, "GET");
      expect(res.status).toBe(404);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "code")).toBe("errors.notFound");
    });
  });

  describe("POST /rooms/:roomId/sweep — commit", () => {
    it("sweeps confirmed resting items, invalidates the unconfirmed one, and never touches the checked-out item", async () => {
      const restingIds = [randomUUID(), randomUUID(), randomUUID()];
      const checkedOutId = randomUUID();

      for (const [i, id] of restingIds.entries()) {
        await seedEquipment(id, ctx.clinicId, {
          name: `Resting Pump ${i}`,
          homeRoomId: ctx.roomId,
          assetTypeId: ctx.assetTypeId,
          custodyState: "returned",
        });
      }
      await seedEquipment(checkedOutId, ctx.clinicId, {
        name: "Checked Out Pump",
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "checked_out",
        checkedOutById: ctx.userId,
        checkedOutByEmail: "holder@ops.local",
      });

      const confirmed = [restingIds[0], restingIds[1]];
      const missing = restingIds[2];

      // D-13: invalidateCurrentAnchor is a no-op with nothing open, so give
      // the item-to-be-missing a prior open anchor (as it would have from an
      // earlier dock-return/citizen-anchor/sweep) so the contradiction has
      // something to invalidate.
      await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: missing,
        dockId: ctx.dockId,
        roomId: ctx.roomId,
        source: "citizen",
      });

      const res = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", {
        confirmedEquipmentIds: confirmed,
      });

      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(res.json.confirmedCount).toBe(2);
      expect(res.json.missingCount).toBe(1);
      expect(getString(res.json, "roomId")).toBe(ctx.roomId);
      expect(getString(res.json, "sweptById")).toBe(ctx.userId);
      expect(typeof getString(res.json, "sweptAt")).toBe("string");

      for (const id of confirmed) {
        const current = await getCurrentAnchor(ctx.clinicId, id as string);
        expect(current).not.toBeNull();
        expect(current?.source).toBe("sweep");
        expect(current?.dockId).toBe(ctx.dockId);
        expect(current?.roomId).toBe(ctx.roomId);
      }

      const missingCurrent = await getCurrentAnchor(ctx.clinicId, missing);
      expect(missingCurrent).toBeNull();
      expect(await lastInvalidatedReason(missing)).toBe("sweep_missing");

      // Checked-out item is never touched — no anchor rows at all.
      expect(await anchorCount(checkedOutId)).toBe(0);

      expect(logAudit).toHaveBeenCalledTimes(1);
      const call = logAudit.mock.calls[0]?.[0] as unknown;
      expect(isRecord(call)).toBe(true);
      if (!isRecord(call)) throw new Error("Expected logAudit call arg to be an object");
      expect(call.actionType).toBe("room_swept");
      expect(call.targetId).toBe(ctx.roomId);
      expect(isRecord(call.metadata) && (call.metadata as Record<string, unknown>).confirmed).toBe(2);
      expect(isRecord(call.metadata) && (call.metadata as Record<string, unknown>).missing).toBe(1);
    });

    it("silently ignores a confirmed id that is checked-out or foreign to the room (no error, no anchor)", async () => {
      const restingId = randomUUID();
      const checkedOutId = randomUUID();
      const foreignId = randomUUID();

      await seedEquipment(restingId, ctx.clinicId, {
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "returned",
      });
      await seedEquipment(checkedOutId, ctx.clinicId, {
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "checked_out",
        checkedOutById: ctx.userId,
        checkedOutByEmail: "holder@ops.local",
      });
      // foreignId is never seeded — not expected-resting in this room at all.

      // Give restingId a prior open anchor so the sweep_missing contradiction
      // (D-13: invalidateCurrentAnchor no-ops with nothing open) is observable.
      await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: restingId,
        dockId: ctx.dockId,
        roomId: ctx.roomId,
        source: "citizen",
      });

      const res = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", {
        confirmedEquipmentIds: [checkedOutId, foreignId],
      });

      expect(res.status).toBe(200);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      // Nothing was actually confirmed; the one expected-resting item (restingId)
      // was not in the confirmed set, so it's missing.
      expect(res.json.confirmedCount).toBe(0);
      expect(res.json.missingCount).toBe(1);

      expect(await anchorCount(checkedOutId)).toBe(0);
      expect(await anchorCount(foreignId)).toBe(0);
      expect(await lastInvalidatedReason(restingId)).toBe("sweep_missing");
    });

    it("404s errors.notFound for a room that doesn't exist in this clinic, with no writes", async () => {
      const res = await api(`/api/docking/rooms/${randomUUID()}/sweep`, "POST", {
        confirmedEquipmentIds: [],
      });
      expect(res.status).toBe(404);
      expect(isRecord(res.json)).toBe(true);
      if (!isRecord(res.json)) throw new Error("Expected response to be an object");
      expect(getString(res.json, "code")).toBe("errors.notFound");
      expect(logAudit).not.toHaveBeenCalled();
    });
  });
});
