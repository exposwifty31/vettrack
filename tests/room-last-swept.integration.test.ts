/**
 * Docking P3 T3.4-i-b (server, Part A) — GET /api/rooms per-room "last
 * swept" fields. Postgres integration test.
 *
 * Adds two per-room fields to the existing GET /api/rooms response, derived
 * from the most recent `source:"sweep"` equipment anchor among items
 * currently homed to the room:
 *  - lastSweptAt: string | null — the anchor's assertedAt (ISO)
 *  - lastSweptByName: string | null — the asserter's displayName/name
 * A room with no sweep anchor gets both null. Non-sweep anchors (citizen,
 * return_toggle, smart_charger) are ignored. Clinic-scoped.
 *
 * Requires DATABASE_URL and migrations 164/165 (docks room/asset_type +
 * vt_equipment_anchors).
 * Run: pnpm test tests/room-last-swept.integration.test.ts
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;

/** The initialized probe pool, or a contextual throw if setup didn't run. */
function requireProbePool(): Pool {
  if (!probePool) {
    throw new Error("probePool is not initialized — DB integration setup (beforeAll) did not run");
  }
  return probePool;
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

/** Assert an unknown value is an array of records before field access (no `as` cast). */
function asRecordArray(val: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(val)) throw new Error("Expected value to be an array");
  return val.filter(isRecord);
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
  await requireProbePool().query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(userId: string, clinicId: string, name: string) {
  await requireProbePool().query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, display_name, role, status, preferred_locale)
     VALUES ($1, $2, $3, $4, $5, $5, 'technician', 'active', 'en')
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, name],
  );
}

async function seedRoom(roomId: string, clinicId: string, name: string) {
  await requireProbePool().query(
    `INSERT INTO vt_rooms (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [roomId, clinicId, name],
  );
}

async function seedAssetType(assetTypeId: string, clinicId: string, name: string) {
  await requireProbePool().query(
    `INSERT INTO vt_asset_types (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [assetTypeId, clinicId, name],
  );
}

async function seedDock(dockId: string, clinicId: string, roomId: string, assetTypeId: string, name: string) {
  await requireProbePool().query(
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
  } = {},
) {
  const homeRoomId = overrides.homeRoomId ?? null;
  await requireProbePool().query(
    `INSERT INTO vt_equipment
       (id, clinic_id, name, status, version, room_id, home_room_id, asset_type_id, custody_state)
     VALUES ($1, $2, $3, 'ok', 1, $4, $5, $6, $7)`,
    [
      eqId,
      clinicId,
      overrides.name ?? "Last Swept Test Pump",
      homeRoomId,
      homeRoomId,
      overrides.assetTypeId ?? null,
      overrides.custodyState ?? "returned",
    ],
  );
}

async function purgeClinic(clinicId: string) {
  const P = requireProbePool();
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
  sweeperUserId: string;
  roomId: string;
  noSweepRoomId: string;
  assetTypeId: string;
  dockId: string;
}

let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("GET /api/rooms — last-swept fields (T3.4-i-b Part A) integration", () => {
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
      sweeperUserId: randomUUID(),
      roomId: randomUUID(),
      noSweepRoomId: randomUUID(),
      assetTypeId: randomUUID(),
      dockId: randomUUID(),
    };
    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userId;
    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userId, ctx.clinicId, "Test Admin");
    await seedUser(ctx.sweeperUserId, ctx.clinicId, "Dana Sweeper");
    await seedRoom(ctx.roomId, ctx.clinicId, "ICU");
    await seedRoom(ctx.noSweepRoomId, ctx.clinicId, "Storage");
    await seedAssetType(ctx.assetTypeId, ctx.clinicId, "Infusion Pump");
    await seedDock(ctx.dockId, ctx.clinicId, ctx.roomId, ctx.assetTypeId, "ICU Pump Dock");
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await requireProbePool().query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  it("returns lastSweptAt/lastSweptByName for a room with a source:sweep anchor on a homed item", async () => {
    const itemId = randomUUID();
    await seedEquipment(itemId, ctx.clinicId, {
      name: "Pump",
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "returned",
    });

    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: itemId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      assertedById: ctx.sweeperUserId,
      source: "sweep",
    });

    const res = await api("/api/rooms");
    expect(res.status).toBe(200);
    const rooms = asRecordArray(res.json);
    const icu = rooms.find((r) => r.id === ctx.roomId);
    expect(icu).toBeDefined();
    expect(icu!.lastSweptAt).toEqual(expect.any(String));
    expect(icu!.lastSweptByName).toBe("Dana Sweeper");
  });

  it("MAJOR (pre-PR review): GET /api/rooms/:id (single room) ALSO returns lastSweptAt/lastSweptByName — all-time, not shift-scoped", async () => {
    const itemId = randomUUID();
    await seedEquipment(itemId, ctx.clinicId, {
      name: "Pump",
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "returned",
    });

    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: itemId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      assertedById: ctx.sweeperUserId,
      source: "sweep",
    });

    const res = await api(`/api/rooms/${ctx.roomId}`);
    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(res.json.lastSweptAt).toEqual(expect.any(String));
    expect(res.json.lastSweptByName).toBe("Dana Sweeper");
  });

  it("returns lastSweptAt:null, lastSweptByName:null for a room with no sweep anchor", async () => {
    const itemId = randomUUID();
    await seedEquipment(itemId, ctx.clinicId, {
      name: "Unswept Pump",
      homeRoomId: ctx.noSweepRoomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "returned",
    });

    const res = await api("/api/rooms");
    expect(res.status).toBe(200);
    const rooms = asRecordArray(res.json);
    const storage = rooms.find((r) => r.id === ctx.noSweepRoomId);
    expect(storage).toBeDefined();
    expect(storage!.lastSweptAt).toBeNull();
    expect(storage!.lastSweptByName).toBeNull();
  });

  it("ignores non-sweep anchor sources (citizen) — lastSweptAt stays null", async () => {
    const itemId = randomUUID();
    await seedEquipment(itemId, ctx.clinicId, {
      name: "Citizen-anchored Pump",
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "returned",
    });

    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: itemId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      assertedById: ctx.sweeperUserId,
      source: "citizen",
    });

    const res = await api("/api/rooms");
    expect(res.status).toBe(200);
    const rooms = asRecordArray(res.json);
    const icu = rooms.find((r) => r.id === ctx.roomId);
    expect(icu).toBeDefined();
    expect(icu!.lastSweptAt).toBeNull();
    expect(icu!.lastSweptByName).toBeNull();
  });

  it("picks the MOST RECENT sweep anchor when a room has more than one (supersede via createAnchor)", async () => {
    const itemId = randomUUID();
    await seedEquipment(itemId, ctx.clinicId, {
      name: "Pump",
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "returned",
    });

    // First sweep by the admin user, then a second (superseding) sweep by
    // the named sweeper — createAnchor invalidates the prior open anchor,
    // so the most-recent-by-assertedAt query must surface the second one.
    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: itemId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      assertedById: ctx.userId,
      source: "sweep",
    });
    await createAnchor(db, {
      clinicId: ctx.clinicId,
      equipmentId: itemId,
      dockId: ctx.dockId,
      roomId: ctx.roomId,
      assertedById: ctx.sweeperUserId,
      source: "sweep",
    });

    const res = await api("/api/rooms");
    expect(res.status).toBe(200);
    const rooms = asRecordArray(res.json);
    const icu = rooms.find((r) => r.id === ctx.roomId);
    expect(icu).toBeDefined();
    expect(icu!.lastSweptByName).toBe("Dana Sweeper");
  });

  it("S2-9 (cross-clinic isolation): a second clinic's sweep anchor never appears in clinic A's lastSwept, and its room is invisible in clinic A's list", async () => {
    const otherClinicId = randomUUID();
    const otherUserId = randomUUID();
    const otherRoomId = randomUUID();
    const otherAssetTypeId = randomUUID();
    const otherDockId = randomUUID();
    const otherEqId = randomUUID();

    await seedClinic(otherClinicId);
    await seedUser(otherUserId, otherClinicId, "Other Clinic Sweeper");
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
      assertedById: otherUserId,
      source: "sweep",
    });

    // Clinic A's own room has no sweep — this must stay unaffected by the
    // unrelated clinic B sweep happening at the same time.
    const itemId = randomUUID();
    await seedEquipment(itemId, ctx.clinicId, {
      name: "Clinic A Pump",
      homeRoomId: ctx.roomId,
      assetTypeId: ctx.assetTypeId,
      custodyState: "returned",
    });

    try {
      const res = await api("/api/rooms");
      expect(res.status).toBe(200);
      const rooms = asRecordArray(res.json);

      // Clinic B's room is entirely invisible in clinic A's list.
      expect(rooms.some((r) => r.id === otherRoomId)).toBe(false);

      const icu = rooms.find((r) => r.id === ctx.roomId);
      expect(icu).toBeDefined();
      expect(icu!.lastSweptAt).toBeNull();
      expect(icu!.lastSweptByName).toBeNull();
    } finally {
      const P = requireProbePool();
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
