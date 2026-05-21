/**
 * Equipment PATCH optimistic concurrency (PR-18 / CO-01).
 *
 * Requires DATABASE_URL and applied migrations (`vt_equipment.version`).
 *
 * Run (explicit):
 *   DATABASE_URL=postgres://vettrack:vettrack@127.0.0.1:5432/vettrack \
 *     pnpm exec vitest run tests/equipment-version-occ.integration.test.ts
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

if (DATABASE_URL) {
  probePool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 1500,
    max: 1,
  });
  try {
    await probePool.query("SELECT 1");
    const versionCol = await probePool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vt_equipment'
          AND column_name = 'version'`,
    );
    dbReachable = versionCol.rows.length === 1;
  } catch {
    dbReachable = false;
  }
}

let currentClinicId = "";
let currentUserId = "";

vi.mock("../server/lib/push.js", () => ({
  checkDedupe: () => true,
  sendPushToAll: vi.fn(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/lib/analytics-cache.js", () => ({
  invalidateAnalyticsCache: vi.fn(),
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: { authUser?: unknown; clinicId?: string }, _res: unknown, next: () => void) => {
    req.authUser = { id: currentUserId, email: "occ@test.local", role: "technician" };
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

describe.skipIf(!dbReachable)("equipment PATCH version OCC (PR-18)", () => {
  let server: Server;
  let baseUrl: string;
  async function patchJson(equipmentId: string, body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/api/equipment/${equipmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = { raw: text };
      }
    }
    return { status: res.status, json };
  }

  async function seedFixture() {
    const clinicId = randomUUID();
    const userId = randomUUID();
    const equipmentId = randomUUID();
    currentClinicId = clinicId;
    currentUserId = userId;

    await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1)`, [clinicId]);
    await probePool!.query(
      `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [userId, clinicId, `clerk_${randomUUID()}`, `occ_${randomUUID()}@test.local`, "OCC Tester"],
    );
    await probePool!.query(
      `INSERT INTO vt_equipment (id, clinic_id, name, status)
       VALUES ($1, $2, $3, 'ok')`,
      [equipmentId, clinicId, "OCC Device"],
    );

    return { clinicId, equipmentId };
  }

  async function purgeClinic(clinicId: string) {
    await probePool!.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
    await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
  }

  async function readRow(equipmentId: string, clinicId: string) {
    const { rows } = await probePool!.query<{ version: number; name: string }>(
      `SELECT version, name FROM vt_equipment
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL`,
      [equipmentId, clinicId],
    );
    return rows[0];
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
    if (probePool) {
      await probePool.end();
    }
  });

  it("bumps version when client omits version on PATCH", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    try {
      expect((await readRow(equipmentId, clinicId))?.version).toBe(1);

      const res = await patchJson(equipmentId, { name: "Renamed without token" });
      expect(res.status).toBe(200);
      expect((res.json as { version?: number }).version).toBe(2);

      const row = await readRow(equipmentId, clinicId);
      expect(row?.name).toBe("Renamed without token");
      expect(row?.version).toBe(2);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("succeeds when expected version matches the loaded row", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    try {
      const res = await patchJson(equipmentId, { name: "With matching token", version: 1 });
      expect(res.status).toBe(200);
      expect((res.json as { version?: number }).version).toBe(2);
      expect((await readRow(equipmentId, clinicId))?.version).toBe(2);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("returns 409 EQUIPMENT_VERSION_CONFLICT when expected version is stale", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    try {
      const first = await patchJson(equipmentId, { name: "First writer", version: 1 });
      expect(first.status).toBe(200);

      const stale = await patchJson(equipmentId, { name: "Stale writer", version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.json.reason).toBe("EQUIPMENT_VERSION_CONFLICT");

      const row = await readRow(equipmentId, clinicId);
      expect(row?.name).toBe("First writer");
      expect(row?.version).toBe(2);
    } finally {
      await purgeClinic(clinicId);
    }
  });

  it("returns 409 when the UPDATE version guard loses the race", async () => {
    const { clinicId, equipmentId } = await seedFixture();
    try {
      await probePool!.query(
        `UPDATE vt_equipment SET version = 3, name = 'Bumped out of band'
          WHERE id = $1 AND clinic_id = $2`,
        [equipmentId, clinicId],
      );

      const res = await patchJson(equipmentId, { name: "Should not apply", version: 1 });
      expect(res.status).toBe(409);
      expect(res.json.reason).toBe("EQUIPMENT_VERSION_CONFLICT");

      const row = await readRow(equipmentId, clinicId);
      expect(row?.name).toBe("Bumped out of band");
      expect(row?.version).toBe(3);
    } finally {
      await purgeClinic(clinicId);
    }
  });
});
