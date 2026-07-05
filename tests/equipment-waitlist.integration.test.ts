/**
 * Equipment waitlist (Phase B) — Postgres integration tests.
 *
 * Requires DATABASE_URL and migration 137 (vt_equipment_waitlist).
 * Run: pnpm test:integration:ops
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
    const { rows: waitlistTable } = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_equipment_waitlist') AS regclass`,
    );
    const { rows: custodyCol } = await probePool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='vt_equipment' AND column_name='custody_state'`,
    );
    dbReachable = waitlistTable[0]?.regclass != null && custodyCol.length === 1;
  } catch {
    dbReachable = false;
  }
}

let currentClinicId = "";
let currentUserId = "";
let currentUserRole = "vet";

vi.mock("../server/lib/push.js", () => ({
  checkDedupe: () => true,
  sendPushToAll: vi.fn(),
  shouldSendPilotEnglishEquipmentPush: () => true,
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/lib/analytics-cache.js", () => ({
  invalidateAnalyticsCache: vi.fn(),
}));

vi.mock("../server/lib/queue.js", () => ({
  enqueueNotificationJob: vi.fn().mockResolvedValue(undefined),
  enqueuePushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/services/operational-metrics.service.js", () => ({
  recordOperationalMetric: vi.fn().mockResolvedValue(undefined),
  isMetricsEnabled: () => false,
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

const equipmentRoutes = (await import("../server/routes/equipment.js")).default;
const opsRoutes = (await import("../server/routes/equipment-operational-state.js")).default;

const { promoteEquipmentWaitlistIfEligible } = await import(
  "../server/services/equipment-waitlist.service.js"
);
const { runEquipmentWaitlistReservationSweep } = await import(
  "../server/workers/equipment-waitlist-reservation.worker.js"
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", i18nMiddleware);
  app.use("/api/equipment", equipmentRoutes);
  app.use("/api", opsRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

type JsonObj = Record<string, unknown>;

async function api(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: JsonObj,
  asUserId?: string,
): Promise<{ status: number; json: JsonObj }> {
  const prev = currentUserId;
  if (asUserId) currentUserId = asUserId;
  try {
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
  } finally {
    if (asUserId) currentUserId = prev;
  }
}

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(userId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status, preferred_locale)
     VALUES ($1, $2, $3, $4, $5, 'vet', 'active', 'en')
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, "Test User"],
  );
}

async function seedEquipment(eqId: string, clinicId: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    id: eqId,
    clinic_id: clinicId,
    name: "Waitlist Device",
    status: "ok",
    custody_state: "docked",
    usage_state: "available",
    readiness_state: "ready",
    version: 1,
    checked_out_by_id: null,
  };
  const row = { ...defaults, ...overrides };
  const keys = Object.keys(row).join(", ");
  const vals = Object.keys(row).map((_, i) => `$${i + 1}`).join(", ");
  await probePool!.query(
    `INSERT INTO vt_equipment (${keys}) VALUES (${vals}) ON CONFLICT (id) DO UPDATE SET
      custody_state = EXCLUDED.custody_state,
      usage_state = EXCLUDED.usage_state,
      checked_out_by_id = EXCLUDED.checked_out_by_id,
      version = EXCLUDED.version`,
    Object.values(row),
  );
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_waitlist WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_staging_queue WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_event_outbox WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_undo_tokens WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_scan_logs WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_unit_condition_states WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_type_conditions WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

async function waitForNotified(
  equipmentId: string,
  clinicId: string,
  expected = 1,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await countNotified(equipmentId, clinicId);
    if (count === expected) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  const final = await countNotified(equipmentId, clinicId);
  throw new Error(`Timed out waiting for ${expected} notified row(s); got ${final}`);
}

async function equipmentCustody(equipmentId: string): Promise<string | null> {
  const { rows } = await probePool!.query<{ custody_state: string }>(
    `SELECT custody_state FROM vt_equipment WHERE id = $1`,
    [equipmentId],
  );
  return rows[0]?.custody_state ?? null;
}

async function countNotified(equipmentId: string, clinicId: string): Promise<number> {
  const { rows } = await probePool!.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM vt_equipment_waitlist
     WHERE equipment_id = $1 AND clinic_id = $2 AND status = 'notified'`,
    [equipmentId, clinicId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function latestOutboxType(clinicId: string, type: string): Promise<string | null> {
  const { rows } = await probePool!.query<{ type: string }>(
    `SELECT type FROM vt_event_outbox WHERE clinic_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`,
    [clinicId, type],
  );
  return rows[0]?.type ?? null;
}

interface Ctx {
  clinicId: string;
  userA: string;
  userB: string;
  userC: string;
  eqId: string;
}

let ctx: Ctx;

describe.skipIf(!dbReachable)("equipment waitlist integration", () => {
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
      userA: randomUUID(),
      userB: randomUUID(),
      userC: randomUUID(),
      eqId: randomUUID(),
    };
    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userA;
    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userA, ctx.clinicId);
    await seedUser(ctx.userB, ctx.clinicId);
    await seedUser(ctx.userC, ctx.clinicId);
    await seedEquipment(ctx.eqId, ctx.clinicId);
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  async function checkoutAs(userId: string) {
    currentUserId = userId;
    const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", { location: "ICU" });
    expect(res.status).toBe(200);
  }

  async function returnAs(userId: string) {
    currentUserId = userId;
    const res = await api(`/api/equipment/${ctx.eqId}/return`, "POST", { isPluggedIn: true });
    expect(res.status).toBe(200);
  }

  it("return → promotes head waiter and emits outbox events", async () => {
    await checkoutAs(ctx.userA);
    expect(await equipmentCustody(ctx.eqId)).toBe("checked_out");
    const join = await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    expect(join.status).toBe(201);

    await returnAs(ctx.userA);
    expect(await equipmentCustody(ctx.eqId)).toBe("returned");
    expect(await countNotified(ctx.eqId, ctx.clinicId)).toBe(1);

    expect(await latestOutboxType(ctx.clinicId, "EQUIPMENT_CUSTODY_STATE_CHANGED")).toBe(
      "EQUIPMENT_CUSTODY_STATE_CHANGED",
    );
    expect(await latestOutboxType(ctx.clinicId, "EQUIPMENT_WAITLIST_PROMOTED")).toBe(
      "EQUIPMENT_WAITLIST_PROMOTED",
    );

    const snap = await api(`/api/equipment/${ctx.eqId}/waitlist`, "GET", undefined, ctx.userB);
    expect(snap.json.myStatus).toBe("notified");
  });

  it("parallel promotion race → exactly one notified row", async () => {
    await checkoutAs(ctx.userA);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userC);
    await returnAs(ctx.userA);
    await waitForNotified(ctx.eqId, ctx.clinicId, 1);

    await Promise.allSettled([
      promoteEquipmentWaitlistIfEligible(ctx.clinicId, ctx.eqId, "return"),
      promoteEquipmentWaitlistIfEligible(ctx.clinicId, ctx.eqId, "return"),
    ]);

    expect(await countNotified(ctx.eqId, ctx.clinicId)).toBe(1);
  });

  it("TTL expiry → expires reservation and promotes next waiter", async () => {
    await checkoutAs(ctx.userA);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userC);
    await returnAs(ctx.userA);
    await waitForNotified(ctx.eqId, ctx.clinicId, 1);

    await probePool!.query(
      // Drizzle writes this naive-timestamp column as UTC wall time, so backdate
      // in UTC too — DB-local now() breaks on machines where Postgres isn't UTC.
      `UPDATE vt_equipment_waitlist SET reservation_expires_at = (now() AT TIME ZONE 'UTC') - interval '1 minute'
       WHERE clinic_id = $1 AND equipment_id = $2 AND status = 'notified'`,
      [ctx.clinicId, ctx.eqId],
    );

    const { expired } = await runEquipmentWaitlistReservationSweep();
    expect(expired).toBeGreaterThanOrEqual(1);
    await waitForNotified(ctx.eqId, ctx.clinicId, 1);

    const rows = await probePool!.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM vt_equipment_waitlist WHERE clinic_id = $1 AND equipment_id = $2 ORDER BY joined_at`,
      [ctx.clinicId, ctx.eqId],
    );
    const notified = rows.rows.filter((r) => r.status === "notified");
    expect(notified).toHaveLength(1);
    expect(notified[0]?.user_id).toBe(ctx.userC);
    expect(await latestOutboxType(ctx.clinicId, "EQUIPMENT_WAITLIST_EXPIRED")).toBe(
      "EQUIPMENT_WAITLIST_EXPIRED",
    );
  });

  it("join and leave emit waitlist outbox types", async () => {
    await checkoutAs(ctx.userA);
    const join = await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    expect(join.status).toBe(201);
    expect(await latestOutboxType(ctx.clinicId, "EQUIPMENT_WAITLIST_JOINED")).toBe(
      "EQUIPMENT_WAITLIST_JOINED",
    );

    const leave = await api(`/api/equipment/${ctx.eqId}/waitlist`, "DELETE", undefined, ctx.userB);
    expect(leave.status).toBe(200);
    expect(await latestOutboxType(ctx.clinicId, "EQUIPMENT_WAITLIST_LEFT")).toBe(
      "EQUIPMENT_WAITLIST_LEFT",
    );
  });

  it("checkout by notified user fulfills waitlist row; blocks other users", async () => {
    await checkoutAs(ctx.userA);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    await returnAs(ctx.userA);
    expect(await countNotified(ctx.eqId, ctx.clinicId)).toBe(1);

    const blocked = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {}, ctx.userC);
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER");

    const co = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {}, ctx.userB);
    expect(co.status).toBe(200);

    const { rows } = await probePool!.query<{ status: string }>(
      `SELECT status FROM vt_equipment_waitlist WHERE clinic_id = $1 AND equipment_id = $2 AND user_id = $3`,
      [ctx.clinicId, ctx.eqId, ctx.userB],
    );
    expect(rows[0]?.status).toBe("fulfilled");
  });

  it("quick-scan by non-reserved user is denied while reservation held (F1 regression)", async () => {
    await checkoutAs(ctx.userA);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    await returnAs(ctx.userA);
    expect(await countNotified(ctx.eqId, ctx.clinicId)).toBe(1);

    const stolen = await api(`/api/equipment/scan`, "POST", { equipmentId: ctx.eqId }, ctx.userC);
    expect(stolen.status).toBe(409);
    expect(stolen.json.code).toBe("equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER");
    expect(await equipmentCustody(ctx.eqId)).toBe("returned");

    const redeemed = await api(`/api/equipment/scan`, "POST", { equipmentId: ctx.eqId }, ctx.userB);
    expect(redeemed.status).toBe(200);
    expect(redeemed.json.action).toBe("checkout");

    const { rows } = await probePool!.query<{ status: string }>(
      `SELECT status FROM vt_equipment_waitlist WHERE clinic_id = $1 AND equipment_id = $2 AND user_id = $3`,
      [ctx.clinicId, ctx.eqId, ctx.userB],
    );
    expect(rows[0]?.status).toBe("fulfilled");
  });

  it("dock-return → promotes head waiter when unit becomes deployable", async () => {
    const dockId = randomUUID();
    const assetTypeId = randomUUID();
    const conditionId = randomUUID();
    await probePool!.query(
      `INSERT INTO vt_docks (id, clinic_id, name) VALUES ($1, $2, 'Dock A') ON CONFLICT DO NOTHING`,
      [dockId, ctx.clinicId],
    );
    await probePool!.query(
      `INSERT INTO vt_asset_types (id, clinic_id, name) VALUES ($1, $2, 'Pump') ON CONFLICT DO NOTHING`,
      [assetTypeId, ctx.clinicId],
    );
    await probePool!.query(
      `INSERT INTO vt_asset_type_conditions (id, clinic_id, asset_type_id, condition_name, verification_method, stale_after_minutes, display_order)
       VALUES ($1, $2, $3, 'Visual', 'visual', 60, 0) ON CONFLICT DO NOTHING`,
      [conditionId, ctx.clinicId, assetTypeId],
    );
    await checkoutAs(ctx.userA);
    await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);

    await probePool!.query(
      `UPDATE vt_equipment SET asset_type_id = $2, dock_id = $3 WHERE id = $1`,
      [ctx.eqId, assetTypeId, dockId],
    );

    await probePool!.query(
      `UPDATE vt_equipment SET custody_state = 'returned', checked_out_by_id = NULL, checked_out_at = NULL,
       usage_state = 'available', readiness_state = 'unknown', version = version + 1
       WHERE id = $1`,
      [ctx.eqId],
    );

    currentUserId = ctx.userA;
    const dockReturn = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
      dockId,
      conditionVerifications: [{ conditionId, verified: true }],
    });
    expect(dockReturn.status).toBe(200);
    await waitForNotified(ctx.eqId, ctx.clinicId, 1);
    expect(await latestOutboxType(ctx.clinicId, "EQUIPMENT_WAITLIST_PROMOTED")).toBe(
      "EQUIPMENT_WAITLIST_PROMOTED",
    );
  });

  it("rejects duplicate active waitlist row for same user", async () => {
    await checkoutAs(ctx.userA);
    const first = await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    expect(first.status).toBe(201);
    const dup = await api(`/api/equipment/${ctx.eqId}/waitlist`, "POST", undefined, ctx.userB);
    expect(dup.status).toBe(409);
  });
});
