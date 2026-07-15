/**
 * Docking P3 T3.3 (server) — GET /api/rooms present-vs-expected room
 * readiness. Postgres integration test.
 *
 * Adds two per-room fields to the existing GET /api/rooms response, computed
 * via the T3.1 reconciliation ladder (classifyReconciliationBucket) and the
 * T1.2/T1.3 helpers (resolveHomeDock, roomExpected):
 *  - expectedFill: count of items homed to the room WITH a category
 *  - atHomeCount: count of homed items that classify as "at_home"
 * All existing counts (totalEquipment, recentlyVerifiedCount, etc.) are
 * preserved unchanged.
 *
 * Requires DATABASE_URL and migrations 164 (docks room/asset_type/capacity)
 * + 165 (vt_equipment_anchors).
 * Run: pnpm test tests/room-readiness.integration.test.ts
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";

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

const roomsRoutes = (await import("../server/routes/rooms.js")).default;
const { createAnchor } = await import("../server/services/equipment-anchor.service.js");
const { db } = await import("../server/db.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/rooms", roomsRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

async function api(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { "Content-Type": "application/json" } });
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
  } = {},
) {
  // room_id (current room / presence) defaults to home_room_id — the legacy
  // totalEquipment metric is keyed off the CURRENT room, not the home room,
  // so tests asserting both metrics need an item that is actually present
  // where it's homed unless a test deliberately wants them to diverge.
  const homeRoomId = overrides.homeRoomId ?? null;
  await probePool!.query(
    `INSERT INTO vt_equipment
       (id, clinic_id, name, status, version, room_id, home_room_id, asset_type_id, custody_state, checked_out_by_id)
     VALUES ($1, $2, $3, 'ok', 1, $4, $5, $6, $7, $8)`,
    [
      eqId,
      clinicId,
      overrides.name ?? "Room Readiness Test Pump",
      homeRoomId,
      homeRoomId,
      overrides.assetTypeId ?? null,
      overrides.custodyState ?? "returned",
      overrides.checkedOutById ?? null,
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
  emptyRoomId: string;
  assetTypeId: string;
  dockId: string;
}

let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("GET /api/rooms — present-vs-expected readiness (T3.3) integration", () => {
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
      emptyRoomId: randomUUID(),
      assetTypeId: randomUUID(),
      dockId: randomUUID(),
    };
    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userId;
    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userId, ctx.clinicId);
    await seedRoom(ctx.roomId, ctx.clinicId, "ICU");
    await seedRoom(ctx.emptyRoomId, ctx.clinicId, "Storage");
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

  it("returns expectedFill:3, atHomeCount:2 for a room with 3 homed items, 2 anchored at the home dock", async () => {
    const itemIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of itemIds.entries()) {
      await seedEquipment(id, ctx.clinicId, {
        name: `Pump ${i}`,
        homeRoomId: ctx.roomId,
        assetTypeId: ctx.assetTypeId,
        custodyState: "returned",
      });
    }

    // Anchor the first two at the home dock — these classify as at_home.
    for (const id of itemIds.slice(0, 2)) {
      await createAnchor(db, {
        clinicId: ctx.clinicId,
        equipmentId: id,
        dockId: ctx.dockId,
        roomId: ctx.roomId,
        source: "citizen",
      });
    }
    // Third item has no anchor at all — not at_home (returned_unverified).

    const res = await api("/api/rooms");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.json)).toBe(true);
    const rooms = res.json as Array<Record<string, unknown>>;
    const icu = rooms.find((r) => r.id === ctx.roomId);
    expect(icu).toBeDefined();
    expect(icu!.expectedFill).toBe(3);
    expect(icu!.atHomeCount).toBe(2);
    // Existing fields preserved.
    expect(icu!.totalEquipment).toBe(3);
  });

  it("returns expectedFill:0, atHomeCount:0 for a room with zero homed items", async () => {
    const res = await api("/api/rooms");

    expect(res.status).toBe(200);
    const rooms = res.json as Array<Record<string, unknown>>;
    const storage = rooms.find((r) => r.id === ctx.emptyRoomId);
    expect(storage).toBeDefined();
    expect(storage!.expectedFill).toBe(0);
    expect(storage!.atHomeCount).toBe(0);
  });

  it("excludes category-less homed items from expectedFill and atHomeCount (roomExpected semantics)", async () => {
    const categorylessId = randomUUID();
    await seedEquipment(categorylessId, ctx.clinicId, {
      name: "Unassigned category item",
      homeRoomId: ctx.roomId,
      assetTypeId: null,
      custodyState: "returned",
    });

    const res = await api("/api/rooms");
    expect(res.status).toBe(200);
    const rooms = res.json as Array<Record<string, unknown>>;
    const icu = rooms.find((r) => r.id === ctx.roomId);
    expect(icu).toBeDefined();
    expect(icu!.expectedFill).toBe(0);
    expect(icu!.atHomeCount).toBe(0);
    // Still counted in the legacy totalEquipment metric.
    expect(icu!.totalEquipment).toBe(1);
  });

  it("excludes checked-out items from atHomeCount (D-9) but keeps them in expectedFill", async () => {
    const checkedOutId = randomUUID();
    await seedEquipment(checkedOutId, ctx.clinicId, {
      name: "Checked-out pump",
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "checked_out",
      checkedOutById: ctx.userId,
    });

    const res = await api("/api/rooms");
    expect(res.status).toBe(200);
    const rooms = res.json as Array<Record<string, unknown>>;
    const icu = rooms.find((r) => r.id === ctx.roomId);
    expect(icu).toBeDefined();
    expect(icu!.expectedFill).toBe(1);
    expect(icu!.atHomeCount).toBe(0);
  });

  it("S2-9 (cross-clinic isolation): a second clinic's homed+at_home equipment must not count in clinic A's expectedFill/atHomeCount", async () => {
    const otherClinicId = randomUUID();
    const otherUserId = randomUUID();
    const otherRoomId = randomUUID();
    const otherAssetTypeId = randomUUID();
    const otherDockId = randomUUID();
    const otherEqId = randomUUID();

    await seedClinic(otherClinicId);
    await seedUser(otherUserId, otherClinicId);
    await seedRoom(otherRoomId, otherClinicId, "Other Clinic Room");
    await seedAssetType(otherAssetTypeId, otherClinicId, "Other Clinic Type");
    await seedDock(otherDockId, otherClinicId, otherRoomId, otherAssetTypeId, "Other Clinic Dock");
    await seedEquipment(otherEqId, otherClinicId, {
      name: "Other Clinic Pump",
      homeRoomId: otherRoomId,
      assetTypeId: otherAssetTypeId,
      custodyState: "returned",
    });
    await createAnchor(db, {
      clinicId: otherClinicId,
      equipmentId: otherEqId,
      dockId: otherDockId,
      roomId: otherRoomId,
      source: "citizen",
    });

    try {
      const res = await api("/api/rooms");
      expect(res.status).toBe(200);
      const rooms = res.json as Array<Record<string, unknown>>;

      // Clinic B's room is entirely invisible in clinic A's list.
      expect(rooms.some((r) => r.id === otherRoomId)).toBe(false);

      // Clinic A's empty room stays at zero — unaffected by clinic B's homed/at_home item.
      const storage = rooms.find((r) => r.id === ctx.emptyRoomId);
      expect(storage).toBeDefined();
      expect(storage!.expectedFill).toBe(0);
      expect(storage!.atHomeCount).toBe(0);
    } finally {
      const P = probePool!;
      await P.query(`DELETE FROM vt_equipment_anchors WHERE clinic_id = $1`, [otherClinicId]);
      await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [otherClinicId]);
      await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [otherClinicId]);
      await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [otherClinicId]);
      await P.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [otherClinicId]);
      await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [otherClinicId]);
      await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [otherClinicId]);
    }
  });
});
