/**
 * F3 — bulk-delete cancels active waitlist + staging rows.
 * Run: DATABASE_URL=... pnpm test -- equipment-bulk-delete-f3
 */
import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.vt_equipment_waitlist') AS regclass`,
    );
    dbReachable = rows[0]?.regclass != null;
  } catch {
    dbReachable = false;
  }
}

let currentClinicId = "";
let currentUserId = "admin-user";

vi.mock("../server/lib/push.js", () => ({ checkDedupe: () => true, sendPushToAll: vi.fn() }));
vi.mock("../server/lib/audit.js", () => ({ logAudit: vi.fn(), resolveAuditActorRole: () => "admin" }));
vi.mock("../server/lib/analytics-cache.js", () => ({ invalidateAnalyticsCache: vi.fn() }));
vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: currentUserId, email: "admin@ops.local", role: "admin" };
    req.clinicId = currentClinicId;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const equipmentRoutes = dbReachable ? (await import("../server/routes/equipment.js")).default : null;

let server: Server;
let baseUrl: string;

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(userId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status, preferred_locale)
     VALUES ($1, $2, $3, $4, $5, 'admin', 'active', 'en') ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, "Admin"],
  );
}

async function seedEquipment(eqId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_equipment (id, clinic_id, name, status, custody_state, usage_state, readiness_state, version)
     VALUES ($1, $2, 'Bulk Del', 'ok', 'docked', 'available', 'ready', 1)
     ON CONFLICT (id) DO NOTHING`,
    [eqId, clinicId],
  );
}

async function seedStagedEquipment(eqId: string, clinicId: string, version = 3) {
  await probePool!.query(
    `INSERT INTO vt_equipment (
       id, clinic_id, name, status, custody_state, usage_state, usage_state_since,
       readiness_state, version
     )
     VALUES ($1, $2, 'Bulk Del Staged', 'ok', 'docked', 'staged', NOW(), 'ready', $3)
     ON CONFLICT (id) DO NOTHING`,
    [eqId, clinicId, version],
  );
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_waitlist WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_staging_queue WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_scan_logs WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

describe.skipIf(!dbReachable)("F3: equipment bulk-delete cleanup", () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/equipment", equipmentRoutes!);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/equipment`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await probePool?.end();
  });

  beforeEach(async () => {
    currentClinicId = `clinic-f3-${randomUUID()}`;
    await seedClinic(currentClinicId);
    await seedUser(currentUserId, currentClinicId);
  });

  it("F3: bulk-delete cancels waiting waitlist and active staging rows", async () => {
    const eqId = randomUUID();
    await seedEquipment(eqId, currentClinicId);

    await probePool!.query(
      `INSERT INTO vt_equipment_waitlist (id, clinic_id, equipment_id, user_id, status, priority)
       VALUES ($1, $2, $3, $4, 'waiting', 0)`,
      [randomUUID(), currentClinicId, eqId, currentUserId],
    );
    await probePool!.query(
      `INSERT INTO vt_staging_queue (id, clinic_id, equipment_id, requested_by_id, status, clinical_priority)
       VALUES ($1, $2, $3, $4, 'active', 'routine')`,
      [randomUUID(), currentClinicId, eqId, currentUserId],
    );

    const res = await fetch(`${baseUrl}/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [eqId] }),
    });
    expect(res.status).toBe(200);

    const { rows: wl } = await probePool!.query<{ status: string }>(
      `SELECT status FROM vt_equipment_waitlist WHERE equipment_id = $1 AND clinic_id = $2`,
      [eqId, currentClinicId],
    );
    expect(wl[0]?.status).toBe("cancelled");

    const { rows: st } = await probePool!.query<{ status: string }>(
      `SELECT status FROM vt_staging_queue WHERE equipment_id = $1 AND clinic_id = $2`,
      [eqId, currentClinicId],
    );
    expect(st[0]?.status).toBe("cancelled");

    await purgeClinic(currentClinicId);
  });

  it("F3: bulk-delete resets usageState='staged' so future restore is checkout-usable", async () => {
    const eqId = randomUUID();
    const initialVersion = 3;
    await seedStagedEquipment(eqId, currentClinicId, initialVersion);

    await probePool!.query(
      `INSERT INTO vt_staging_queue (id, clinic_id, equipment_id, requested_by_id, status, clinical_priority)
       VALUES ($1, $2, $3, $4, 'active', 'routine')`,
      [randomUUID(), currentClinicId, eqId, currentUserId],
    );

    const res = await fetch(`${baseUrl}/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [eqId] }),
    });
    expect(res.status).toBe(200);

    const { rows: st } = await probePool!.query<{ status: string }>(
      `SELECT status FROM vt_staging_queue WHERE equipment_id = $1 AND clinic_id = $2`,
      [eqId, currentClinicId],
    );
    expect(st[0]?.status).toBe("cancelled");

    const { rows: eq } = await probePool!.query<{
      usage_state: string;
      version: number;
      deleted_at: Date | null;
    }>(
      `SELECT usage_state, version, deleted_at FROM vt_equipment WHERE id = $1 AND clinic_id = $2`,
      [eqId, currentClinicId],
    );
    expect(eq[0]?.deleted_at).not.toBeNull();
    expect(eq[0]?.usage_state).toBe("available");
    expect(Number(eq[0]?.version)).toBe(initialVersion + 1);

    await purgeClinic(currentClinicId);
  });
});
