/**
 * Part B Phase 1 (server) — proactive room-sweep missing-equipment alert — Postgres
 * integration test for the full route → outbox/acks path.
 *
 * Covers, for POST /api/docking/rooms/:roomId/sweep leaving missingCount>0:
 *  (a) a NEW EQUIPMENT_MISSING_ALERT row on vt_event_outbox (ALERT / WARNING, correct
 *      clinicId, carrying the missing equipmentIds + count) — rides the frozen outbox.
 *  (b) a manager-tier sendPushToRole call (admin + vet) with a per-sweep tag.
 *  (c) an equipment_missing_alerted audit.
 *  (d) idempotency — a second identical sweep within the window does NOT double-alert.
 *
 * Requires DATABASE_URL + migrations (vt_event_outbox, vt_alert_acks, vt_equipment_anchors).
 * Run: pnpm test tests/equipment-missing-alert.integration.test.ts
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

function requireProbePool(): Pool {
  if (!probePool) throw new Error("probePool is not initialized — DB integration setup did not run");
  return probePool;
}

let currentClinicId = "";
let currentUserId = "";

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/lib/push.js", () => ({
  sendPushToRole: vi.fn().mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 }),
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: currentUserId, email: "test@ops.local", role: "admin" };
    req.clinicId = currentClinicId;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const dockingRoutes = (await import("../server/routes/docking.js")).default;
const { logAudit } = (await import("../server/lib/audit.js")) as unknown as { logAudit: ReturnType<typeof vi.fn> };
const { sendPushToRole } = (await import("../server/lib/push.js")) as unknown as {
  sendPushToRole: ReturnType<typeof vi.fn>;
};

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

async function api(path: string, method: "GET" | "POST" = "GET", body?: Record<string, unknown>) {
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
  await requireProbePool().query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}
async function seedUser(userId: string, clinicId: string) {
  await requireProbePool().query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status, preferred_locale)
     VALUES ($1, $2, $3, $4, $5, 'admin', 'active', 'en') ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, "Test Admin"],
  );
}
async function seedRoom(roomId: string, clinicId: string, name: string) {
  await requireProbePool().query(`INSERT INTO vt_rooms (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
    roomId,
    clinicId,
    name,
  ]);
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
async function seedEquipment(eqId: string, clinicId: string, roomId: string, assetTypeId: string) {
  await requireProbePool().query(
    `INSERT INTO vt_equipment
       (id, clinic_id, name, status, version, home_room_id, asset_type_id, custody_state)
     VALUES ($1, $2, $3, 'ok', 1, $4, $5, 'returned')`,
    [eqId, clinicId, "Missing-Alert Test Pump", roomId, assetTypeId],
  );
}

interface OutboxRow {
  type: string;
  level: string;
  category: string;
  clinic_id: string;
  payload: { roomId?: string; equipmentIds?: string[]; count?: number };
}

async function missingAlertOutboxRows(clinicId: string): Promise<OutboxRow[]> {
  const { rows } = await requireProbePool().query<OutboxRow>(
    `SELECT type, level, category, clinic_id, payload FROM vt_event_outbox
     WHERE clinic_id = $1 AND type = 'EQUIPMENT_MISSING_ALERT' ORDER BY id ASC`,
    [clinicId],
  );
  return rows;
}

async function alertAckCount(clinicId: string): Promise<number> {
  const { rows } = await requireProbePool().query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM vt_alert_acks WHERE clinic_id = $1 AND alert_type = 'sweep_missing_alert'`,
    [clinicId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function purgeClinic(clinicId: string) {
  const P = requireProbePool();
  await P.query(`DELETE FROM vt_event_outbox WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_alert_acks WHERE clinic_id = $1`, [clinicId]);
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

describe.skipIf(!DATABASE_URL)("room-sweep missing-equipment alert (Part B P1) integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL required");
    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
    try {
      await probePool.query("SELECT 1");
    } catch (err) {
      if (probePool) {
        await probePool.end();
        probePool = null;
      }
      throw new Error(`Database connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const app = buildApp();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
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
    sendPushToRole.mockClear();
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("a sweep leaving an item missing raises an ALERT/WARNING outbox event, pushes managers, and audits", async () => {
    const missingId = randomUUID();
    await seedEquipment(missingId, ctx.clinicId, ctx.roomId, ctx.assetTypeId);

    const res = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] });
    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("Expected response object");
    expect(res.json.missingCount).toBe(1);

    // (a) exactly one EQUIPMENT_MISSING_ALERT outbox row, ALERT/WARNING, clinic-scoped, with ids + count.
    const rows = await missingAlertOutboxRows(ctx.clinicId);
    expect(rows.length).toBe(1);
    expect(rows[0].level).toBe("WARNING");
    expect(rows[0].category).toBe("ALERT");
    expect(rows[0].clinic_id).toBe(ctx.clinicId);
    expect(rows[0].payload.roomId).toBe(ctx.roomId);
    expect(rows[0].payload.equipmentIds).toEqual([missingId]);
    expect(rows[0].payload.count).toBe(1);

    // (b) manager-tier push with a per-sweep tag. The push fans out in the BACKGROUND after the
    // sweep response returns, so poll until both manager-role calls land rather than treating the
    // HTTP response as the push's completion signal.
    await vi.waitFor(() => {
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "admin", expect.objectContaining({ tag: `equipment-missing:${ctx.roomId}` }));
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "vet", expect.objectContaining({ tag: `equipment-missing:${ctx.roomId}` }));
    });

    // (c) equipment_missing_alerted audit (room_swept is the first call).
    const alerted = logAudit.mock.calls.some(
      (c) => isRecord(c[0]) && (c[0] as Record<string, unknown>).actionType === "equipment_missing_alerted",
    );
    expect(alerted).toBe(true);

    // one durable ack row for the alerted item.
    expect(await alertAckCount(ctx.clinicId)).toBe(1);
  });

  it("(d) a second identical sweep within the window does NOT double-alert (idempotent)", async () => {
    const missingId = randomUUID();
    await seedEquipment(missingId, ctx.clinicId, ctx.roomId, ctx.assetTypeId);

    await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] });
    expect((await missingAlertOutboxRows(ctx.clinicId)).length).toBe(1);
    expect(await alertAckCount(ctx.clinicId)).toBe(1);

    // The first sweep's push is detached — let both manager-role calls land before clearing, so a
    // late background call can't bleed past the reset and pollute the second-sweep assertion.
    await vi.waitFor(() => {
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "admin", expect.anything());
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "vet", expect.anything());
    });
    sendPushToRole.mockClear();

    // Second sweep — item is still missing, but it was alerted within the window.
    const res2 = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] });
    expect(res2.status).toBe(200);
    if (!isRecord(res2.json)) throw new Error("Expected response object");
    expect(res2.json.missingCount).toBe(1); // still missing at the sweep layer

    // No NEW alert: outbox + ack counts unchanged, and no push fired the second time.
    expect((await missingAlertOutboxRows(ctx.clinicId)).length).toBe(1);
    expect(await alertAckCount(ctx.clinicId)).toBe(1);
    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  it("(e) re-alerts once the dedupe window expires (reclaims the expired ack, not a swallowed 23505)", async () => {
    const missingId = randomUUID();
    await seedEquipment(missingId, ctx.clinicId, ctx.roomId, ctx.assetTypeId);

    // First sweep → one alert, one durable ack.
    await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] });
    expect((await missingAlertOutboxRows(ctx.clinicId)).length).toBe(1);
    expect(await alertAckCount(ctx.clinicId)).toBe(1);
    await vi.waitFor(() => {
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "admin", expect.anything());
    });
    sendPushToRole.mockClear();

    // Age the ack far past the dedupe window (default 4h) so the next sweep must RE-alert. Before the
    // upsert fix, this second alert's insert hit the lifetime UNIQUE(equipment_id, alert_type) → 23505
    // → the whole transaction (including the outbox event) rolled back → the route swallowed it → the
    // re-alert was silently lost. This is the regression guard: without the fix, the outbox count
    // below stays 1. (Same 23505 path that would break concurrent same-room sweeps — see case f.)
    await requireProbePool().query(
      `UPDATE vt_alert_acks SET acknowledged_at = now() - interval '30 hours'
       WHERE clinic_id = $1 AND alert_type = 'sweep_missing_alert'`,
      [ctx.clinicId],
    );

    // Second sweep — item still missing, prior ack now expired → a NEW alert must fire.
    const res2 = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] });
    expect(res2.status).toBe(200);
    if (!isRecord(res2.json)) throw new Error("Expected response object");
    expect(res2.json.missingCount).toBe(1);

    // A SECOND outbox alert row appears (re-alert), and the ack row is reclaimed IN PLACE (still 1 —
    // never deleted, timestamp refreshed), proving the transaction committed rather than rolling back.
    expect((await missingAlertOutboxRows(ctx.clinicId)).length).toBe(2);
    expect(await alertAckCount(ctx.clinicId)).toBe(1);
    await vi.waitFor(() => {
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "admin", expect.anything());
      expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "vet", expect.anything());
    });
  });

  it("(f) two concurrent sweeps of the same room emit exactly one alert and one ack (no swallowed 23505)", async () => {
    const missingId = randomUUID();
    await seedEquipment(missingId, ctx.clinicId, ctx.roomId, ctx.assetTypeId);

    // Both sweeps read "no ack yet" pre-transaction and race to claim the same missing id. The ack
    // upsert is the atomic claim gate: onConflictDoUpdate(... setWhere: acknowledgedAt < cutoff)
    // RETURNING. The winner inserts a fresh row and claims it; the loser's conflict finds a row the
    // winner just made fresh (>= cutoff), so the conditional update matches nothing, RETURNING is
    // empty, and the loser claims nothing → it emits NO outbox event. The outcome is deterministic:
    // exactly one alert regardless of interleaving, and never a conflict-to-error (23505).
    const [res1, res2] = await Promise.all([
      api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] }),
      api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [] }),
    ]);
    // Both requests succeed. (A swallowed 23505 rollback would still 200 at the route, so the real
    // proof is the exactly-one alert + exactly-one ack below, not the status codes alone.)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Exactly one ack row (the lifetime UNIQUE(equipment_id, alert_type)) AND exactly one outbox
    // alert — the losing sweep neither duplicated the WARNING nor hid a 23505.
    expect(await alertAckCount(ctx.clinicId)).toBe(1);
    expect((await missingAlertOutboxRows(ctx.clinicId)).length).toBe(1);
  });

  it("a clean sweep (a confirmed expected item, nothing missing) raises no alert", async () => {
    // Seed an item EXPECTED to rest in the room, then confirm it in the sweep so the confirmed
    // path is actually exercised. missingCount stays 0, so no alert/outbox/push is raised.
    const confirmedId = randomUUID();
    await seedEquipment(confirmedId, ctx.clinicId, ctx.roomId, ctx.assetTypeId);

    const res = await api(`/api/docking/rooms/${ctx.roomId}/sweep`, "POST", { confirmedEquipmentIds: [confirmedId] });
    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("Expected response object");
    expect(res.json.confirmedCount).toBe(1);
    expect(res.json.missingCount).toBe(0);

    expect((await missingAlertOutboxRows(ctx.clinicId)).length).toBe(0);
    expect(sendPushToRole).not.toHaveBeenCalled();
  });
});
