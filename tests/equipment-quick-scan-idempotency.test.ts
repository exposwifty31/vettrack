/**
 * S16.2 — the flat quick-scan alias `POST /api/equipment/scan` must honour
 * `Idempotency-Key` replay like every other custody mutation on this router.
 *
 * Why this route is special: quick-scan is a *toggle*. Replaying it without a
 * replay guard does not repeat the first effect — it undoes it. A duplicated
 * delivery of "check this out" silently becomes "return it", so the failure
 * mode is a lost custody record rather than a duplicate one.
 *
 * Requires DATABASE_URL and applied migrations (`vt_idempotency_keys`, equipment V1 columns)
 * for the integration block; the registry block is pure and always runs.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";
import { EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS } from "../server/lib/equipment-replay-idempotency.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

let probePool: Pool | null = null;

/**
 * `describe.skipIf` does not narrow `probePool` for TypeScript inside the suite
 * body, which is why every use was written `db()`. A non-null assertion
 * per call site is 13 separate promises that the value is set; this is one
 * check that says so out loud and fails with a readable message if it is ever
 * wrong.
 */
function db(): Pool {
  if (!probePool) throw new Error("probePool is not initialised — this suite must not have run");
  return probePool;
}
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
  } catch (err) {
    // DATABASE_URL is SET, so someone meant this suite to run. Swallowing the
    // failure turned "the database is unreachable" and "the guard works" into
    // the same green result — a silent skip and a passing check look identical
    // from outside, and only one of them is honest. Skipping stays legitimate
    // only when no database was configured at all (see the guard below).
    let cleanupErr: unknown = null;
    await probePool.end().catch((e: unknown) => {
      cleanupErr = e;
    });
    probePool = null;
    throw new Error(
      `DATABASE_URL is configured but the equipment quick-scan idempotency suite cannot use it: ${
        err instanceof Error ? err.message : String(err)
      }${cleanupErr ? `; pool cleanup also failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}` : ""}`,
    );
  }
  if (!schemaReady) {
    let cleanupErr: unknown = null;
    await probePool.end().catch((e: unknown) => {
      cleanupErr = e;
    });
    probePool = null;
    throw new Error(
      "DATABASE_URL is configured but vt_equipment is missing custody_state/version, " +
        "or vt_idempotency_keys does not exist. Run the migrations, or unset DATABASE_URL to skip this suite." +
        (cleanupErr ? ` (pool cleanup also failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)})` : ""),
    );
  }
}

let currentClinicId = "";
let currentUserId = "";

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
  requireAuth: (
    req: { authUser?: { id: string; email: string; role: string }; clinicId?: string },
    _res: unknown,
    next: () => void,
  ) => {
    req.authUser = { id: currentUserId, email: `${currentUserId}@test.local`, role: "technician" };
    req.clinicId = currentClinicId;
    next();
  },
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const equipmentRoutes = (await import("../server/routes/equipment.js")).default;

describe("equipment replay registry — quick-scan alias", () => {
  it("registers POST /api/equipment/scan under its own endpoint key", () => {
    expect(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS).toHaveProperty("quickScan");
    expect(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.quickScan).toBe("POST /api/equipment/scan");
  });

  it("keeps every endpoint string in the registry unique", () => {
    // `endpoint` is the label persisted on vt_idempotency_keys and emitted as
    // `route` on collision telemetry. Cross-route serving is blocked elsewhere
    // (the request hash covers the URL), but a duplicated label would file one
    // route's replay rows under another's name.
    const values = Object.values(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS);
    expect(values).toHaveLength(9);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe.skipIf(!dbReachable || !schemaReady)(
  "POST /api/equipment/scan — offline replay idempotency",
  () => {
    let server: Server;
    let baseUrl: string;

    async function seedFixture() {
      const clinicId = randomUUID();
      const userId = randomUUID();
      const equipmentId = randomUUID();
      currentClinicId = clinicId;
      currentUserId = userId;

      await db().query(`INSERT INTO vt_clinics (id) VALUES ($1)`, [clinicId]);
      await db().query(
        `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [
          userId,
          clinicId,
          `clerk_${randomUUID()}`,
          `quickscan_${randomUUID()}@test.local`,
          "Quick Scan Actor",
        ],
      );
      await db().query(
        `INSERT INTO vt_equipment (
           id, clinic_id, name, status, custody_state, usage_state, checked_out_by_id
         ) VALUES ($1, $2, $3, 'ok', 'returned', 'available', NULL)`,
        [equipmentId, clinicId, "Quick Scan Device"],
      );

      return { clinicId, equipmentId, userId };
    }

    async function purgeClinic(clinicId: string) {
      await db().query(`DELETE FROM vt_idempotency_keys WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_scan_logs WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_undo_tokens WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_equipment_returns WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
      await db().query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
    }

    async function countScanLogs(clinicId: string, equipmentId: string) {
      const { rows } = await db().query<{ count: string }>(
        `SELECT count(*)::text AS count FROM vt_scan_logs
          WHERE clinic_id = $1 AND equipment_id = $2`,
        [clinicId, equipmentId],
      );
      return Number(rows[0]?.count ?? 0);
    }

    // Scoped by clinicId like every other query in this codebase. A fixture
    // helper that reads across tenants is how a tenancy regression passes its
    // own test: the row would still be found after the guard stopped scoping it.
    async function readCustodyHolder(equipmentId: string, clinicId: string) {
      const { rows } = await db().query<{ checked_out_by_id: string | null }>(
        `SELECT checked_out_by_id FROM vt_equipment WHERE id = $1 AND clinic_id = $2`,
        [equipmentId, clinicId],
      );
      return rows[0]?.checked_out_by_id ?? null;
    }

    beforeAll(async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/equipment", equipmentRoutes);
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

    it("replays the first checkout instead of toggling back to returned", async () => {
      const { clinicId, equipmentId, userId } = await seedFixture();
      const idempotencyKey = randomUUID();
      try {
        const url = `${baseUrl}/api/equipment/scan`;
        const init = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ equipmentId }),
        };

        const first = await fetch(url, init);
        expect(first.status).toBe(200);
        const firstBody = await first.json();
        expect(firstBody.action).toBe("checkout");

        const second = await fetch(url, init);
        expect(second.status).toBe(200);
        const secondBody = await second.json();

        // Without the replay guard the toggle runs again and returns the device.
        expect(secondBody.action).toBe("checkout");
        expect(secondBody.scanLogId).toBe(firstBody.scanLogId);
        expect(await countScanLogs(clinicId, equipmentId)).toBe(1);
        expect(await readCustodyHolder(equipmentId, clinicId)).toBe(userId);
      } finally {
        await purgeClinic(clinicId);
      }
    });

    it("serializes two CONCURRENT requests on one key — the toggle runs once", async () => {
      const { clinicId, equipmentId, userId } = await seedFixture();
      const idempotencyKey = randomUUID();
      try {
        const url = `${baseUrl}/api/equipment/scan`;
        const init = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ equipmentId }),
        };

        // Both in flight before either response persists: without per-key
        // serialization both miss the stored row, the toggle runs twice, and
        // the second run flips custody straight back to returned.
        const [first, second] = await Promise.all([fetch(url, init), fetch(url, init)]);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const firstBody = await first.json();
        const secondBody = await second.json();

        expect(firstBody.action).toBe("checkout");
        expect(secondBody.action).toBe("checkout");
        expect(secondBody.scanLogId).toBe(firstBody.scanLogId);
        expect(await countScanLogs(clinicId, equipmentId)).toBe(1);
        expect(await readCustodyHolder(equipmentId, clinicId)).toBe(userId);
      } finally {
        await purgeClinic(clinicId);
      }
    });

    it("rejects a reused key carrying a different equipmentId", async () => {
      const { clinicId, equipmentId } = await seedFixture();
      const otherEquipmentId = randomUUID();
      const idempotencyKey = randomUUID();
      try {
        await db().query(
          `INSERT INTO vt_equipment (
             id, clinic_id, name, status, custody_state, usage_state, checked_out_by_id
           ) VALUES ($1, $2, $3, 'ok', 'returned', 'available', NULL)`,
          [otherEquipmentId, clinicId, "Quick Scan Device B"],
        );

        const url = `${baseUrl}/api/equipment/scan`;
        const first = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ equipmentId }),
        });
        expect(first.status).toBe(200);

        const conflict = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ equipmentId: otherEquipmentId }),
        });
        expect(conflict.status).toBe(409);
        expect((await conflict.json()).reason).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH");
        expect(await countScanLogs(clinicId, otherEquipmentId)).toBe(0);
      } finally {
        await purgeClinic(clinicId);
      }
    });

    it("still toggles normally when no Idempotency-Key is sent", async () => {
      const { clinicId, equipmentId } = await seedFixture();
      try {
        const url = `${baseUrl}/api/equipment/scan`;
        const init = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ equipmentId }),
        };

        const first = await fetch(url, init);
        expect(first.status).toBe(200);
        expect((await first.json()).action).toBe("checkout");

        const second = await fetch(url, init);
        expect(second.status).toBe(200);
        expect((await second.json()).action).toBe("return");

        expect(await readCustodyHolder(equipmentId, clinicId)).toBeNull();
      } finally {
        await purgeClinic(clinicId);
      }
    });
  },
);
