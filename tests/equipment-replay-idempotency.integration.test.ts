/**
 * Phase 4 — equipment offline replay idempotency (mutable actions + scan transport dedup).
 *
 * Requires DATABASE_URL and applied migrations (`vt_idempotency_keys`, equipment V1 columns).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

let probePool: Pool | null = null;
let dbReachable = false;
let schemaReady = false;

if (DATABASE_URL) {
  probePool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 1500,
    max: 1,
  });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
    const cols = await probePool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vt_equipment'
          AND column_name IN ('custody_state', 'version')`,
    );
    const names = new Set(cols.rows.map((r) => r.column_name));
    const idempotencyTable = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_idempotency_keys') AS regclass`,
    );
    schemaReady =
      names.has("custody_state") &&
      names.has("version") &&
      idempotencyTable.rows[0]?.regclass != null;
  } catch {
    dbReachable = false;
    schemaReady = false;
  }
}

let currentClinicId = "";
let currentUserId = "";
let secondUserId = "";

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

vi.mock("../server/lib/role-notification-scheduler.js", () => ({
  scheduleSmartReturnReminder: vi.fn(),
  cancelSmartReturnReminder: vi.fn(),
}));

vi.mock("../server/workers/chargeAlertWorker.js", () => ({
  enqueueChargeAlertJob: vi.fn().mockResolvedValue(null),
}));

vi.mock("../server/lib/realtime-outbox.js", () => ({
  insertRealtimeDomainEvent: vi.fn(),
}));

vi.mock("../server/lib/sync-metrics.js", () => ({
  trackSyncSuccess: vi.fn(),
  trackSyncFail: vi.fn(),
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: { authUser?: { id: string; email: string; role: string }; clinicId?: string }, _res: unknown, next: () => void) => {
    const headerUser = (req as { headers?: Record<string, string> }).headers?.["x-test-user-id"];
    const id = headerUser === "user-b" ? secondUserId : currentUserId;
    req.authUser = { id, email: `${id}@test.local`, role: "technician" };
    req.clinicId = currentClinicId;
    next();
  },
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const equipmentRoutes = (await import("../server/routes/equipment.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", equipmentRoutes);
  return app;
}

describe.skipIf(!dbReachable || !schemaReady)("equipment replay idempotency (Phase 4)", () => {
  let server: Server;
  let baseUrl: string;

  async function seedFixture() {
    const clinicId = randomUUID();
    const userId = randomUUID();
    const userB = randomUUID();
    const equipmentId = randomUUID();
    currentClinicId = clinicId;
    currentUserId = userId;
    secondUserId = userB;

    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1)`, [clinicId]);
    for (const [id, email] of [[userId, "a"], [userB, "b"]] as const) {
      await probePool!.query(
        `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [id, clinicId, `clerk_${randomUUID()}`, `replay_${email}_${randomUUID()}@test.local`, `Replay ${email}`],
      );
    }
    await probePool!.query(
      `INSERT INTO vt_equipment (
         id, clinic_id, name, status, custody_state, usage_state, checked_out_by_id
       ) VALUES ($1, $2, $3, 'ok', 'returned', 'available', NULL)`,
      [equipmentId, clinicId, "Replay Device"],
    );

    return { clinicId, equipmentId };
  }

  async function purgeClinic(clinicId: string) {
    await probePool!.query(`DELETE FROM vt_idempotency_keys WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_scan_logs WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_undo_tokens WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_equipment_returns WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
  }

  async function countScanLogs(clinicId: string, equipmentId: string) {
    const { rows } = await probePool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vt_scan_logs
        WHERE clinic_id = $1 AND equipment_id = $2`,
      [clinicId, equipmentId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  beforeAll(async () => {
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

  it("duplicate checkout replay with same Idempotency-Key produces one scan log", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    const idempotencyKey = randomUUID();
    try {
      const url = `${baseUrl}/api/equipment/${equipmentId}/checkout`;
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ location: "Ward" }),
      };
      const first = await fetch(url, init);
      expect(first.status).toBe(200);
      const second = await fetch(url, init);
      expect(second.status).toBe(200);
      const body1 = await first.json();
      const body2 = await second.json();
      expect(body2.equipment.id).toBe(body1.equipment.id);
      expect(await countScanLogs(clinicId, equipmentId)).toBe(1);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("duplicate return replay with same Idempotency-Key produces one return scan log", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    const checkoutKey = randomUUID();
    const returnKey = randomUUID();
    try {
      const checkoutUrl = `${baseUrl}/api/equipment/${equipmentId}/checkout`;
      await fetch(checkoutUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": checkoutKey },
        body: "{}",
      });

      const returnUrl = `${baseUrl}/api/equipment/${equipmentId}/return`;
      const returnInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": returnKey,
        },
        body: JSON.stringify({ isPluggedIn: true }),
      };
      const first = await fetch(returnUrl, returnInit);
      expect(first.status).toBe(200);
      const second = await fetch(returnUrl, returnInit);
      expect(second.status).toBe(200);

      const { rows } = await probePool!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM vt_scan_logs
          WHERE clinic_id = $1 AND equipment_id = $2 AND note LIKE '%Returned%'`,
        [clinicId, equipmentId],
      );
      expect(Number(rows[0]?.count ?? 0)).toBe(1);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("two scan replays with different keys create two audit rows", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    try {
      const url = `${baseUrl}/api/equipment/${equipmentId}/scan`;
      const baseBody = { status: "ok" as const, note: "round" };
      const first = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ ...baseBody, note: "first" }),
      });
      const second = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ ...baseBody, note: "second" }),
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await countScanLogs(clinicId, equipmentId)).toBe(2);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("duplicate scan transport replay with same key creates one scan row", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    const idempotencyKey = randomUUID();
    try {
      const url = `${baseUrl}/api/equipment/${equipmentId}/scan`;
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ status: "maintenance", note: "belt" }),
      };
      expect((await fetch(url, init)).status).toBe(200);
      expect((await fetch(url, init)).status).toBe(200);
      expect(await countScanLogs(clinicId, equipmentId)).toBe(1);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("same header key from another user does not reuse cached success body", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    const idempotencyKey = randomUUID();
    try {
      const url = `${baseUrl}/api/equipment/${equipmentId}/checkout`;
      const resA = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "x-test-user-id": "user-a",
        },
        body: "{}",
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();

      const resB = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "x-test-user-id": "user-b",
        },
        body: "{}",
      });
      expect([409, 422]).toContain(resB.status);
      expect(bodyA.equipment.checkedOutById).toBe(currentUserId);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("reused key with different body returns IDEMPOTENCY_KEY_BODY_MISMATCH", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    const idempotencyKey = randomUUID();
    try {
      const url = `${baseUrl}/api/equipment/${equipmentId}/scan`;
      const first = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ status: "ok", note: "alpha" }),
      });
      expect(first.status).toBe(200);

      const conflict = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ status: "ok", note: "beta" }),
      });
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).reason).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH");
      expect(await countScanLogs(clinicId, equipmentId)).toBe(1);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("version conflict still returns 409 for stale PATCH with a new idempotency key", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    try {
      const url = `${baseUrl}/api/equipment/${equipmentId}`;
      const first = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ name: "First", version: 1 }),
      });
      expect(first.status).toBe(200);

      const stale = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ name: "Stale", version: 1 }),
      });
      expect(stale.status).toBe(409);
      expect((await stale.json()).reason).toBe("EQUIPMENT_VERSION_CONFLICT");
    } finally {
      await purgeClinic(clinicId);
    }
  });
});
