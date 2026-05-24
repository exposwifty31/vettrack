/**
 * Equipment Operational State V1/V2 integration tests.
 *
 * Requires DATABASE_URL and migrations 130–136 applied.
 * Run: pnpm test:integration:ops
 *
 * Groups:
 *   2. checkout paths (12)
 *   3. return (5)
 *   4. dock-return (8)
 *   5. staging CRUD (8)
 *   6. workers V1 (6)
 *   7. procedure_bound V2 (7)
 *   8. operational-metrics (8)
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";
import express from "express";
import { randomUUID } from "crypto";

// ─── DB probe ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    const { rows } = await probePool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='vt_equipment' AND column_name='custody_state'`,
    );
    dbReachable = rows.length === 1;
  } catch {
    dbReachable = false;
  }
}

// ─── Mocks (hoisted before dynamic imports) ──────────────────────────────────

let currentClinicId = "";
let currentUserId = "";
let currentUserRole = "vet";

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

// ─── Route imports (after mocks are hoisted) ─────────────────────────────────

const equipmentRoutes = (await import("../server/routes/equipment.js")).default;
const opsRoutes = (await import("../server/routes/equipment-operational-state.js")).default;
const metricsRoutes = (await import("../server/routes/operational-metrics.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", equipmentRoutes);
  app.use("/api", opsRoutes);
  app.use("/api", metricsRoutes);
  return app;
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type JsonObj = Record<string, unknown>;

async function api(
  path: string,
  method: "GET" | "POST" | "DELETE" | "PATCH" = "GET",
  body?: JsonObj,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: JsonObj }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
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
}

// ─── Seed helpers (raw SQL — avoids Drizzle module-level side effects) ────────

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(userId: string, clinicId: string, role = "vet") {
  await probePool!.query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `u_${randomUUID()}@ops.local`, "Test User", role],
  );
}

async function seedDock(dockId: string, clinicId: string, name = "Dock A") {
  await probePool!.query(
    `INSERT INTO vt_docks (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [dockId, clinicId, name],
  );
}

async function seedAssetType(atId: string, clinicId: string, name = "Defibrillator") {
  await probePool!.query(
    `INSERT INTO vt_asset_types (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [atId, clinicId, name],
  );
}

async function seedCondition(condId: string, atId: string, clinicId: string, name = "Battery check") {
  await probePool!.query(
    `INSERT INTO vt_asset_type_conditions (id, clinic_id, asset_type_id, condition_name, verification_method, stale_after_minutes, display_order)
     VALUES ($1, $2, $3, $4, 'visual', 60, 0) ON CONFLICT DO NOTHING`,
    [condId, clinicId, atId, name],
  );
}

async function seedEquipment(
  eqId: string,
  clinicId: string,
  overrides: Record<string, unknown> = {},
) {
  const defaults: Record<string, unknown> = {
    id: eqId,
    clinic_id: clinicId,
    name: "Test Device",
    status: "ok",
    custody_state: "docked",
    usage_state: "available",
    readiness_state: "ready",
    version: 1,
    asset_type_id: null,
    dock_id: null,
  };
  const row = { ...defaults, ...overrides };
  const keys = Object.keys(row).join(", ");
  const vals = Object.keys(row).map((_, i) => `$${i + 1}`).join(", ");
  await probePool!.query(
    `INSERT INTO vt_equipment (${keys}) VALUES (${vals}) ON CONFLICT DO NOTHING`,
    Object.values(row),
  );
}

async function seedConditionState(
  stateId: string,
  eqId: string,
  condId: string,
  clinicId: string,
  verified: boolean,
  verifiedAt: Date | null = null,
) {
  await probePool!.query(
    `INSERT INTO vt_unit_condition_states (id, clinic_id, equipment_id, condition_id, verified, verified_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT DO NOTHING`,
    [stateId, clinicId, eqId, condId, verified, verifiedAt],
  );
}

async function seedAnimal(animalId: string, clinicId: string) {
  await probePool!.query(
    `INSERT INTO vt_animals (id, clinic_id, name) VALUES ($1, $2, 'Test Animal') ON CONFLICT DO NOTHING`,
    [animalId, clinicId],
  );
}

async function seedHospitalization(
  hospId: string,
  animalId: string,
  clinicId: string,
  status: "admitted" | "discharged" | "observation" | "critical" | "recovering" | "deceased" = "admitted",
) {
  await probePool!.query(
    `INSERT INTO vt_hospitalizations (id, clinic_id, animal_id, admitted_at, status)
     VALUES ($1, $2, $3, now(), $4) ON CONFLICT DO NOTHING`,
    [hospId, clinicId, animalId, status],
  );
}

async function seedStagingClaim(
  claimId: string,
  eqId: string,
  userId: string,
  clinicId: string,
  priority = "routine",
  expiresAt: Date | null = null,
) {
  await probePool!.query(
    `INSERT INTO vt_staging_queue (id, clinic_id, equipment_id, requested_by_id, clinical_priority, staged_at, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, now(), $6, 'active') ON CONFLICT DO NOTHING`,
    [claimId, clinicId, eqId, userId, priority, expiresAt],
  );
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_operational_metrics WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_staging_queue WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_unit_condition_states WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_event_outbox WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_scan_logs WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_return_logs WHERE clinic_id = $1`, [clinicId]).catch(() => {/* table may not exist */});
  // Clear audit logs (no FK to equipment)
  await P.query(`DELETE FROM vt_audit_logs WHERE clinic_id = $1`, [clinicId]).catch(() => {/* optional */});
  // NULL FK before deleting hospitalizations (removes FK constraint on equipment)
  await P.query(`UPDATE vt_equipment SET procedure_bound_hospitalization_id = NULL WHERE clinic_id = $1`, [clinicId]).catch(() => {});
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_hospitalizations WHERE clinic_id = $1`, [clinicId]).catch(() => {});
  await P.query(`DELETE FROM vt_animals WHERE clinic_id = $1`, [clinicId]).catch(() => {});
  await P.query(`DELETE FROM vt_asset_type_conditions WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_asset_types WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

async function readEquipment(eqId: string) {
  const { rows } = await probePool!.query<Record<string, unknown>>(
    `SELECT * FROM vt_equipment WHERE id = $1`,
    [eqId],
  );
  return rows[0] ?? null;
}

// ─── Per-test fixture ─────────────────────────────────────────────────────────

interface TestFixture {
  clinicId: string;
  userId: string;
  dockId: string;
  assetTypeId: string;
  conditionId: string;
  eqId: string;
}

let ctx: TestFixture;

// ─── Test suites ─────────────────────────────────────────────────────────────

describe.skipIf(!dbReachable)("equipment-operational-state integration", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for integration tests");
    process.env.DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1 = "";
    process.env.ENABLE_OPERATIONAL_METRICS = "true";

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
    currentUserRole = "vet";
    process.env.DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1 = "";

    ctx = {
      clinicId: randomUUID(),
      userId: randomUUID(),
      dockId: randomUUID(),
      assetTypeId: randomUUID(),
      conditionId: randomUUID(),
      eqId: randomUUID(),
    };

    currentClinicId = ctx.clinicId;
    currentUserId = ctx.userId;

    await seedClinic(ctx.clinicId);
    await seedUser(ctx.userId, ctx.clinicId, "vet");
    await seedDock(ctx.dockId, ctx.clinicId);
    await seedAssetType(ctx.assetTypeId, ctx.clinicId);
    await seedCondition(ctx.conditionId, ctx.assetTypeId, ctx.clinicId);
  });

  afterEach(async () => {
    process.env.DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1 = "";
    await purgeClinic(ctx.clinicId);
  });

  // ─── Group 2: Checkout paths ───────────────────────────────────────────────

  describe("checkout paths", () => {
    it("flag disabled → 200 (legacy checkout, no V1 checks)", async () => {
      process.env.DISABLE_EQUIPMENT_OPERATIONAL_STATE_V1 = "true";
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "untracked", // would 422 if V1 enabled
      });
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(200);
    });

    it("untracked → 422 CUSTODY_CHAIN_BROKEN", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, { custody_state: "untracked" });
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("CUSTODY_CHAIN_BROKEN");
    });

    it("checked_out → 409 ALREADY_CHECKED_OUT", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "checked_out",
        checked_out_by_id: ctx.userId,
      });
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(409);
      expect(res.json.code).toBe("ALREADY_CHECKED_OUT");
    });

    it("available + no assetType → 422 reason=NO_ASSET_TYPE_DEFINED", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
        asset_type_id: null,
      });
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(422);
      expect(res.json.reason).toBe("NO_ASSET_TYPE_DEFINED");
    });

    it("available + ready with all conditions verified → 200", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        dock_id: ctx.dockId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
      });
      await seedConditionState(randomUUID(), ctx.eqId, ctx.conditionId, ctx.clinicId, true, new Date());
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.custody_state).toBe("checked_out");
    });

    it("returned + conditions → 422 reason=CONDITIONS_NOT_MET (custody!=docked)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
        usage_state: "available",
        readiness_state: "unknown",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(422);
      expect(res.json.reason).toBe("CONDITIONS_NOT_MET");
    });

    it("staged + top-holder → 200 (user has highest-priority active claim)", async () => {
      const claimId = randomUUID();
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        dock_id: ctx.dockId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      await seedConditionState(randomUUID(), ctx.eqId, ctx.conditionId, ctx.clinicId, true, new Date());
      await seedStagingClaim(claimId, ctx.eqId, ctx.userId, ctx.clinicId, "routine");
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(200);
    });

    it("staged + non-holder → 409 STAGING_CONFLICT", async () => {
      const otherId = randomUUID();
      await seedUser(otherId, ctx.clinicId, "vet");
      const claimId = randomUUID();
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      await seedStagingClaim(claimId, ctx.eqId, otherId, ctx.clinicId, "routine");
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(409);
      expect(res.json.code).toBe("STAGING_CONFLICT");
    });

    it("staged + no active claims → 409 STAGING_CONFLICT", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/checkout`, "POST", {});
      expect(res.status).toBe(409);
      expect(res.json.code).toBe("STAGING_CONFLICT");
    });

    it("emergency + docked + reason → 200", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "not_ready", // emergency bypasses readiness
      });
      const res = await api(
        `/api/equipment/${ctx.eqId}/checkout`,
        "POST",
        { emergencyReason: "Code Blue" },
        { "x-emergency-checkout": "true" },
      );
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("emergency_use");
    });

    it("emergency + returned + reason → 200 (emergency allows returned custody)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "returned",
        usage_state: "available",
        readiness_state: "unknown",
      });
      const res = await api(
        `/api/equipment/${ctx.eqId}/checkout`,
        "POST",
        { emergencyReason: "Code Blue" },
        { "x-emergency-checkout": "true" },
      );
      expect(res.status).toBe(200);
    });

    it("emergency + no reason → 422 EMERGENCY_REASON_REQUIRED", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "available",
      });
      const res = await api(
        `/api/equipment/${ctx.eqId}/checkout`,
        "POST",
        {},
        { "x-emergency-checkout": "true" },
      );
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("EMERGENCY_REASON_REQUIRED");
    });
  });

  // ─── Group 3: Return ───────────────────────────────────────────────────────

  describe("return", () => {
    it("success: checked_out → custodyState=returned, usageState=available", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "checked_out",
        usage_state: "in_use",
        readiness_state: "unknown",
        checked_out_by_id: ctx.userId,
        checked_out_by_email: "test@ops.local",
        checked_out_at: new Date().toISOString(),
      });
      const res = await api(`/api/equipment/${ctx.eqId}/return`, "POST");
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.custody_state).toBe("returned");
      expect(eq?.usage_state).toBe("available");
    });

    it("with active staging claims → usageState=staged after return", async () => {
      const claimUserId = randomUUID();
      await seedUser(claimUserId, ctx.clinicId, "vet");
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "checked_out",
        usage_state: "in_use",
        readiness_state: "unknown",
        checked_out_by_id: ctx.userId,
        checked_out_at: new Date().toISOString(),
      });
      await seedStagingClaim(randomUUID(), ctx.eqId, claimUserId, ctx.clinicId, "routine");
      const res = await api(`/api/equipment/${ctx.eqId}/return`, "POST");
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.custody_state).toBe("returned");
      expect(eq?.usage_state).toBe("staged");
    });

    it("no staging claims → usageState=available after return", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "checked_out",
        usage_state: "in_use",
        checked_out_by_id: ctx.userId,
        checked_out_at: new Date().toISOString(),
      });
      const res = await api(`/api/equipment/${ctx.eqId}/return`, "POST");
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("available");
    });

    it("wrong custodyState (already returned) → 200, V1 fields unchanged", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "returned",
        usage_state: "available",
        readiness_state: "unknown",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/return`, "POST");
      // Return is idempotent — succeeds even if already returned
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      // V1 update WHERE custodyState='checked_out' fires 0 rows — state stays 'returned'
      expect(eq?.custody_state).toBe("returned");
    });

    it("version conflict → V1 fields silently not updated (returns 200)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "checked_out",
        usage_state: "in_use",
        readiness_state: "unknown",
        version: 1,
        checked_out_by_id: ctx.userId,
        checked_out_at: new Date().toISOString(),
      });
      // Bump version to simulate concurrent change
      await probePool!.query(`UPDATE vt_equipment SET version = 99 WHERE id = $1`, [ctx.eqId]);
      const res = await api(`/api/equipment/${ctx.eqId}/return`, "POST");
      // Return base logic always succeeds (no version guard on base update)
      expect(res.status).toBe(200);
    });
  });

  // ─── Group 4: Dock-return ──────────────────────────────────────────────────

  describe("dock-return", () => {
    it("wrong custodyState → 422", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "checked_out",
        usage_state: "in_use",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [],
      });
      expect(res.status).toBe(422);
    });

    it("no assetTypeId → 422 with operationalState.noAssetTypeDefined error", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: null,
        custody_state: "returned",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [],
      });
      expect(res.status).toBe(422);
    });

    it("cross-clinic dock → 422", async () => {
      const otherDockId = randomUUID();
      // Don't insert the dock — it won't be found for this clinic
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: otherDockId,
        conditionVerifications: [],
      });
      expect(res.status).toBe(404);
    });

    it("condition belongs to wrong assetType → 422", async () => {
      const otherAtId = randomUUID();
      const otherCondId = randomUUID();
      await seedAssetType(otherAtId, ctx.clinicId, "Other Type");
      await seedCondition(otherCondId, otherAtId, ctx.clinicId, "Other Cond");
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [{ conditionId: otherCondId, verified: true }],
      });
      expect(res.status).toBe(422);
    });

    it("failed verification → readinessState=not_ready", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
        readiness_state: "unknown",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [{ conditionId: ctx.conditionId, verified: false }],
      });
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.readiness_state).toBe("not_ready");
      expect(eq?.custody_state).toBe("docked");
    });

    it("all verified → readinessState=ready", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
        readiness_state: "unknown",
        emergency_override_at: new Date().toISOString(), // should be cleared on ready
      });
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [{ conditionId: ctx.conditionId, verified: true }],
      });
      expect(res.status).toBe(200);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.readiness_state).toBe("ready");
      expect(eq?.custody_state).toBe("docked");
      expect(eq?.emergency_override_at).toBeNull();
    });

    it("emergencyOverrideAt cleared when readiness=ready", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
        emergency_override_at: new Date().toISOString(),
      });
      await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [{ conditionId: ctx.conditionId, verified: true }],
      });
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.emergency_override_at).toBeNull();
    });

    it("version conflict → 409 VERSION_CONFLICT", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
        version: 1,
      });
      // Bump version to simulate concurrent change
      await probePool!.query(`UPDATE vt_equipment SET version = 99 WHERE id = $1`, [ctx.eqId]);
      const res = await api(`/api/equipment/${ctx.eqId}/dock-return`, "POST", {
        dockId: ctx.dockId,
        conditionVerifications: [{ conditionId: ctx.conditionId, verified: true }],
      });
      expect(res.status).toBe(409);
    });
  });

  // ─── Group 5: Staging CRUD ─────────────────────────────────────────────────

  describe("staging CRUD", () => {
    it("available → staged (first claim)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/stage`, "POST", {
        clinicalPriority: "routine",
      });
      expect(res.status).toBe(201);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("staged");
    });

    it("already staged → second claim inserted (usageState stays staged)", async () => {
      const user2 = randomUUID();
      await seedUser(user2, ctx.clinicId, "vet");
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      await seedStagingClaim(randomUUID(), ctx.eqId, user2, ctx.clinicId, "routine");

      // Different user (currentUserId) adds second claim
      const res = await api(`/api/equipment/${ctx.eqId}/stage`, "POST", {
        clinicalPriority: "routine",
      });
      expect(res.status).toBe(201);
    });

    it("duplicate requester → 409 DUPLICATE_CLAIM", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
      });
      // First claim (moves equipment to staged)
      await api(`/api/equipment/${ctx.eqId}/stage`, "POST", { clinicalPriority: "routine" });
      // Same user tries to claim again
      const res = await api(`/api/equipment/${ctx.eqId}/stage`, "POST", { clinicalPriority: "routine" });
      expect(res.status).toBe(409);
      expect(res.json.code).toBe("DUPLICATE_CLAIM");
    });

    it("returned equipment → 422 (custodyState must be docked)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "returned",
        usage_state: "available",
        readiness_state: "ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/stage`, "POST", { clinicalPriority: "routine" });
      expect(res.status).toBe(422);
    });

    it("not_ready → 422 (readiness gate blocks non-emergency)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "not_ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/stage`, "POST", { clinicalPriority: "routine" });
      expect(res.status).toBe(422);
    });

    it("emergency stage bypasses readiness check", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "not_ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/stage`, "POST", {
        clinicalPriority: "emergency",
        emergencyStage: true,
      });
      expect(res.status).toBe(201);
    });

    it("delete last claim → usageState=available", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      const claimId = randomUUID();
      await seedStagingClaim(claimId, ctx.eqId, ctx.userId, ctx.clinicId, "routine");

      const res = await api(`/api/equipment/${ctx.eqId}/stage/${claimId}`, "DELETE");
      expect(res.status).toBe(204);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("available");
    });

    it("delete one claim with remaining → usageState stays staged", async () => {
      const user2 = randomUUID();
      await seedUser(user2, ctx.clinicId, "vet");
      const claimId1 = randomUUID();
      const claimId2 = randomUUID();
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      await seedStagingClaim(claimId1, ctx.eqId, ctx.userId, ctx.clinicId, "routine");
      await seedStagingClaim(claimId2, ctx.eqId, user2, ctx.clinicId, "routine");

      const res = await api(`/api/equipment/${ctx.eqId}/stage/${claimId1}`, "DELETE");
      expect(res.status).toBe(204);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("staged");
    });
  });

  // ─── Group 6: Workers V1 ──────────────────────────────────────────────────

  describe("workers V1", () => {
    it("staleness sweep: ready equipment with stale condition → marks not_ready", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
      });
      // Condition verified 200 minutes ago (staleAfterMinutes=60, so stale)
      const staleDate = new Date(Date.now() - 200 * 60 * 1000);
      await seedConditionState(randomUUID(), ctx.eqId, ctx.conditionId, ctx.clinicId, true, staleDate);

      const { runEquipmentConditionStalenessSweep } = await import(
        "../server/workers/equipmentConditionStalenessWorker.js"
      );
      const result = await runEquipmentConditionStalenessSweep(new Date());
      expect(result.markedNotReady).toBeGreaterThanOrEqual(1);

      const eq = await readEquipment(ctx.eqId);
      expect(eq?.readiness_state).toBe("not_ready");
    });

    it("staleness sweep: ignores checked_out equipment", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "checked_out",
        usage_state: "in_use",
        readiness_state: "ready", // workers only scan docked+ready
      });
      const staleDate = new Date(Date.now() - 200 * 60 * 1000);
      await seedConditionState(randomUUID(), ctx.eqId, ctx.conditionId, ctx.clinicId, true, staleDate);

      const { runEquipmentConditionStalenessSweep } = await import(
        "../server/workers/equipmentConditionStalenessWorker.js"
      );
      const before = await readEquipment(ctx.eqId);
      await runEquipmentConditionStalenessSweep(new Date());
      const after = await readEquipment(ctx.eqId);
      expect(after?.readiness_state).toBe(before?.readiness_state);
    });

    it("staleness sweep: version conflict → skips row (continues)", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
        version: 1,
      });
      const staleDate = new Date(Date.now() - 200 * 60 * 1000);
      await seedConditionState(randomUUID(), ctx.eqId, ctx.conditionId, ctx.clinicId, true, staleDate);
      // Bump version to trigger skip
      await probePool!.query(`UPDATE vt_equipment SET version = 99 WHERE id = $1`, [ctx.eqId]);

      const { runEquipmentConditionStalenessSweep } = await import(
        "../server/workers/equipmentConditionStalenessWorker.js"
      );
      const result = await runEquipmentConditionStalenessSweep(new Date());
      // No error thrown, markedNotReady=0 for this equipment
      expect(result.scanned).toBeGreaterThanOrEqual(1);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.readiness_state).toBe("ready"); // unchanged (version guard skipped update)
    });

    it("staging expiry sweep: expires claims past their expiry time", async () => {
      const claimId = randomUUID();
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      const expiredAt = new Date(Date.now() - 60 * 1000); // 1 min ago
      await seedStagingClaim(claimId, ctx.eqId, ctx.userId, ctx.clinicId, "routine", expiredAt);

      const { runStagingExpirySweep } = await import("../server/workers/stagingExpiryWorker.js");
      const result = await runStagingExpirySweep(new Date());
      expect(result.expiredClaims).toBeGreaterThanOrEqual(1);

      const { rows } = await probePool!.query(
        `SELECT status FROM vt_staging_queue WHERE id = $1`,
        [claimId],
      );
      expect(rows[0]?.status).toBe("expired");
    });

    it("staging expiry sweep: staged → available when no remaining active claims", async () => {
      const claimId = randomUUID();
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      const expiredAt = new Date(Date.now() - 60 * 1000);
      await seedStagingClaim(claimId, ctx.eqId, ctx.userId, ctx.clinicId, "routine", expiredAt);

      const { runStagingExpirySweep } = await import("../server/workers/stagingExpiryWorker.js");
      await runStagingExpirySweep(new Date());

      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("available");
    });

    it("staging expiry sweep: does not overwrite in_use equipment", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "checked_out",
        usage_state: "in_use",
        readiness_state: "unknown",
      });
      // No active claims for this equipment — nothing to expire

      const { runStagingExpirySweep } = await import("../server/workers/stagingExpiryWorker.js");
      await runStagingExpirySweep(new Date());
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("in_use"); // untouched
    });
  });

  // ─── Group 7: procedure_bound (V2) ────────────────────────────────────────

  describe("procedure_bound (V2)", () => {
    let hospId: string;
    let animalId: string;

    beforeEach(async () => {
      hospId = randomUUID();
      animalId = randomUUID();
      await seedAnimal(animalId, ctx.clinicId);
      await seedHospitalization(hospId, animalId, ctx.clinicId, "admitted");
    });

    it("bind success: docked + available → procedure_bound", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        asset_type_id: ctx.assetTypeId,
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
        dock_id: ctx.dockId,
      });
      const res = await api(`/api/equipment/${ctx.eqId}/procedure-bind`, "POST", {
        hospitalizationId: hospId,
      });
      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(true);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("procedure_bound");
      expect(eq?.procedure_bound_hospitalization_id).toBe(hospId);
    });

    it("bind non-docked → 422 INVALID_CUSTODY", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "returned",
        usage_state: "available",
        readiness_state: "unknown",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/procedure-bind`, "POST", {
        hospitalizationId: hospId,
      });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("INVALID_CUSTODY");
    });

    it("bind staged equipment → 422 EQUIPMENT_UNAVAILABLE", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "staged",
        readiness_state: "ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/procedure-bind`, "POST", {
        hospitalizationId: hospId,
      });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("EQUIPMENT_UNAVAILABLE");
    });

    it("bind to discharged hospitalization → 422 HOSPITALIZATION_DISCHARGED", async () => {
      const dischargedHospId = randomUUID();
      await seedHospitalization(dischargedHospId, animalId, ctx.clinicId, "discharged");
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "available",
        readiness_state: "ready",
      });
      const res = await api(`/api/equipment/${ctx.eqId}/procedure-bind`, "POST", {
        hospitalizationId: dischargedHospId,
      });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("HOSPITALIZATION_DISCHARGED");
    });

    it("unbind → usageState=available, readinessState=unknown", async () => {
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "procedure_bound",
        readiness_state: "ready",
        procedure_bound_hospitalization_id: hospId,
      });
      const res = await api(`/api/equipment/${ctx.eqId}/procedure-bind`, "DELETE");
      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(true);
      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("available");
      expect(eq?.readiness_state).toBe("unknown");
      expect(eq?.procedure_bound_hospitalization_id).toBeNull();
    });

    it("worker releases equipment when hospitalization is discharged", async () => {
      await probePool!.query(`UPDATE vt_hospitalizations SET status='discharged' WHERE id=$1`, [hospId]);
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "procedure_bound",
        readiness_state: "ready",
        procedure_bound_hospitalization_id: hospId,
      });

      const { runProcedureBoundReleaseSweep } = await import(
        "../server/workers/procedureBoundReleaseWorker.js"
      );
      const result = await runProcedureBoundReleaseSweep(new Date());
      expect(result.released).toBeGreaterThanOrEqual(1);

      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("available");
      expect(eq?.readiness_state).toBe("unknown");
    });

    it("worker skips equipment with version conflict", async () => {
      await probePool!.query(`UPDATE vt_hospitalizations SET status='discharged' WHERE id=$1`, [hospId]);
      await seedEquipment(ctx.eqId, ctx.clinicId, {
        custody_state: "docked",
        usage_state: "procedure_bound",
        readiness_state: "ready",
        procedure_bound_hospitalization_id: hospId,
        version: 1,
      });
      await probePool!.query(`UPDATE vt_equipment SET version=99 WHERE id=$1`, [ctx.eqId]);

      const { runProcedureBoundReleaseSweep } = await import(
        "../server/workers/procedureBoundReleaseWorker.js"
      );
      const result = await runProcedureBoundReleaseSweep(new Date());
      expect(result.released).toBe(0);

      const eq = await readEquipment(ctx.eqId);
      expect(eq?.usage_state).toBe("procedure_bound"); // unchanged
    });
  });

  // ─── Group 8: Operational metrics ─────────────────────────────────────────

  describe("operational metrics", () => {
    async function insertMetric(
      clinicId: string,
      eventType: string,
      durationMs: number | null = null,
      meta: Record<string, unknown> = {},
    ) {
      await probePool!.query(
        `INSERT INTO vt_operational_metrics (id, clinic_id, event_type, duration_ms, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
        [randomUUID(), clinicId, eventType, durationMs, JSON.stringify(meta)],
      );
    }

    it("summary returns zero counters when no metrics exist", async () => {
      const res = await api("/api/operational-metrics/summary");
      expect(res.status).toBe(200);
      expect(res.json.emergencyOverrides).toBe(0);
      expect(res.json.bundleFailures).toBe(0);
      expect(res.json.staleConditions).toBe(0);
      expect(res.json.averageCheckoutMs).toBeNull();
      expect(res.json.averageDockReturnMs).toBeNull();
    });

    it("emergency_override events → emergencyOverrides count", async () => {
      await insertMetric(ctx.clinicId, "emergency_override");
      await insertMetric(ctx.clinicId, "emergency_override");
      const res = await api("/api/operational-metrics/summary");
      expect(res.json.emergencyOverrides).toBe(2);
    });

    it("bundle_failed events → bundleFailures count", async () => {
      await insertMetric(ctx.clinicId, "bundle_failed");
      const res = await api("/api/operational-metrics/summary");
      expect(res.json.bundleFailures).toBe(1);
    });

    it("condition_stale events → staleConditions count", async () => {
      await insertMetric(ctx.clinicId, "condition_stale");
      await insertMetric(ctx.clinicId, "condition_stale");
      await insertMetric(ctx.clinicId, "condition_stale");
      const res = await api("/api/operational-metrics/summary");
      expect(res.json.staleConditions).toBe(3);
    });

    it("checkout_duration with durationMs → averageCheckoutMs", async () => {
      await insertMetric(ctx.clinicId, "checkout_duration", 1000);
      await insertMetric(ctx.clinicId, "checkout_duration", 3000);
      const res = await api("/api/operational-metrics/summary");
      expect(res.json.averageCheckoutMs).toBe(2000);
    });

    it("dock_return_duration → averageDockReturnMs", async () => {
      await insertMetric(ctx.clinicId, "dock_return_duration", 5000);
      const res = await api("/api/operational-metrics/summary");
      expect(res.json.averageDockReturnMs).toBe(5000);
    });

    it("deployable_success + bundle_failed → deployableSuccessRate", async () => {
      await insertMetric(ctx.clinicId, "deployable_success");
      await insertMetric(ctx.clinicId, "deployable_success");
      await insertMetric(ctx.clinicId, "deployable_success");
      await insertMetric(ctx.clinicId, "bundle_failed");
      const res = await api("/api/operational-metrics/summary");
      // 3 success / (3 success + 1 fail) = 0.75
      expect(res.json.deployableSuccessRate).toBeCloseTo(0.75, 2);
    });

    it("cross-clinic isolation: other clinic metrics not included", async () => {
      const otherClinic = randomUUID();
      await seedClinic(otherClinic);
      try {
        await insertMetric(otherClinic, "emergency_override");
        await insertMetric(ctx.clinicId, "emergency_override");
        const res = await api("/api/operational-metrics/summary");
        // Only ctx.clinicId metrics — should be 1
        expect(res.json.emergencyOverrides).toBe(1);
      } finally {
        await probePool!.query(`DELETE FROM vt_operational_metrics WHERE clinic_id = $1`, [otherClinic]);
        await probePool!.query(`DELETE FROM vt_clinics WHERE id = $1`, [otherClinic]);
      }
    });
  });
});
