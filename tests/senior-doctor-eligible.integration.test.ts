/**
 * Doctor shift gate (spec 2026-08-13) — Task 6: admin toggle for
 * `vt_users.senior_doctor_eligible` — Postgres integration tests.
 *
 * Mirrors tests/equipment-coordinator.integration.test.ts (case 5 / S2-14):
 *  - PATCH /api/users/:id/senior-doctor-eligible: admin sets/clears the
 *    static eligibility flag; clinic-scoped; audited with
 *    `senior_doctor_eligible_set`.
 *  - non-admin actor -> 403, flag untouched.
 *  - cross-clinic target id -> 404, flag untouched.
 *  - GET /api/users/me returns `seniorDoctorEligible` (false for a fresh vet)
 *    — the RN gate reads it from the identity payload.
 *
 * Requires DATABASE_URL and migration 181 (vt_users.senior_doctor_eligible).
 * Run: pnpm test tests/senior-doctor-eligible.integration.test.ts
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

/** The initialized probe pool, or a contextual throw if setup didn't run. */
function requireProbePool(): Pool {
  if (!probePool) {
    throw new Error("probePool is not initialized — DB integration setup (beforeAll) did not run");
  }
  return probePool;
}

let currentClinicId = "";
let currentUserId = "";
let currentUserRole = "admin";

function setActor(userId: string, role: string) {
  currentUserId = userId;
  currentUserRole = role;
}

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = {
      id: currentUserId,
      email: `${currentUserId}@ops.local`,
      name: "Test Actor",
      role: currentUserRole,
      clinicId: currentClinicId,
    };
    req.clinicId = currentClinicId;
    next();
  },
  requireAuthAny: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = {
      id: currentUserId,
      email: `${currentUserId}@ops.local`,
      name: "Test Actor",
      role: currentUserRole,
      clinicId: currentClinicId,
    };
    req.clinicId = currentClinicId;
    next();
  },
  requireAdmin: (req: Record<string, unknown>, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (currentUserRole !== "admin") {
      res.status(403).json({ code: "FORBIDDEN" });
      return;
    }
    next();
  },
}));

const usersRoutes = (await import("../server/routes/users.js")).default;
const { logAudit } = (await import("../server/lib/audit.js")) as unknown as { logAudit: ReturnType<typeof vi.fn> };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", i18nMiddleware);
  app.use("/api/users", usersRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
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
  await requireProbePool().query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(
  userId: string,
  clinicId: string,
  opts: { name: string; role?: string; seniorDoctorEligible?: boolean },
) {
  await requireProbePool().query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, display_name, role, status, preferred_locale, senior_doctor_eligible)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'active', 'en', $7)
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, opts.name, opts.role ?? "vet", opts.seniorDoctorEligible ?? false],
  );
}

async function seniorDoctorEligibleFlag(userId: string, expectedClinicId: string): Promise<boolean> {
  // Clinic-scoped assertion oracle: the tenant boundary is part of what the
  // tests verify, so the read filters by clinicId too.
  const { rows } = await requireProbePool().query<{ senior_doctor_eligible: boolean }>(
    `SELECT senior_doctor_eligible FROM vt_users WHERE id = $1 AND clinic_id = $2`,
    [userId, expectedClinicId],
  );
  return rows[0]?.senior_doctor_eligible === true;
}

async function purgeClinic(clinicId: string) {
  const P = requireProbePool();
  await P.query(`DELETE FROM vt_clinical_check_ins WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

let clinicId = "";

describe.skipIf(!DATABASE_URL)("senior_doctor_eligible admin toggle (doctor shift gate, Task 6)", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL required");
    }

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

    try {
      await probePool.query("SELECT 1");
      const { rows } = await probePool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'vt_users' AND column_name = 'senior_doctor_eligible'`,
      );
      if (rows.length !== 1) {
        throw new Error("vt_users.senior_doctor_eligible column missing (migration 181 not applied?)");
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
    // beforeAll may have thrown before assigning `server` — don't let the
    // hook's own TypeError mask the real diagnostic.
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (probePool) {
      await probePool.end();
      probePool = null;
    }
  });

  beforeEach(async () => {
    clinicId = randomUUID();
    currentClinicId = clinicId;
    setActor(randomUUID(), "admin");
    await seedClinic(clinicId);
    logAudit.mockClear();
  });

  afterEach(async () => {
    await purgeClinic(clinicId);
  });

  it("admin PATCH sets senior_doctor_eligible=true (clinic-scoped) and writes a senior_doctor_eligible_set audit row", async () => {
    const target = randomUUID();
    await seedUser(target, clinicId, { name: "Dr. Roni Adar", role: "vet" });

    const res = await api(`/api/users/${target}/senior-doctor-eligible`, "PATCH", { seniorDoctorEligible: true });

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(res.json.seniorDoctorEligible).toBe(true);
    expect(await seniorDoctorEligibleFlag(target, clinicId)).toBe(true);

    expect(logAudit).toHaveBeenCalledTimes(1);
    const call = logAudit.mock.calls[0]?.[0] as unknown;
    if (!isRecord(call)) throw new Error("expected object");
    expect(call.actionType).toBe("senior_doctor_eligible_set");
    expect(call.targetId).toBe(target);
    expect(call.clinicId).toBe(clinicId);
    expect(isRecord(call.metadata) && (call.metadata as Record<string, unknown>).seniorDoctorEligible).toBe(true);
  });

  it("admin PATCH clears the flag back to false", async () => {
    const target = randomUUID();
    await seedUser(target, clinicId, { name: "Dr. Dana Cohen", role: "vet", seniorDoctorEligible: true });

    const res = await api(`/api/users/${target}/senior-doctor-eligible`, "PATCH", { seniorDoctorEligible: false });

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(res.json.seniorDoctorEligible).toBe(false);
    expect(await seniorDoctorEligibleFlag(target, clinicId)).toBe(false);
  });

  it("non-admin actor -> 403, flag untouched", async () => {
    const target = randomUUID();
    await seedUser(target, clinicId, { name: "Dr. Roni Adar", role: "vet" });

    setActor(randomUUID(), "technician");
    const res = await api(`/api/users/${target}/senior-doctor-eligible`, "PATCH", { seniorDoctorEligible: true });

    expect(res.status).toBe(403);
    expect(await seniorDoctorEligibleFlag(target, clinicId)).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("cross-clinic target id -> 404, flag untouched (clinic-scoped WHERE)", async () => {
    const otherClinicId = randomUUID();
    const target = randomUUID();
    await seedClinic(otherClinicId);
    await seedUser(target, otherClinicId, { name: "Dr. Other Clinic", role: "vet" });

    try {
      const res = await api(`/api/users/${target}/senior-doctor-eligible`, "PATCH", { seniorDoctorEligible: true });

      expect(res.status).toBe(404);
      expect(await seniorDoctorEligibleFlag(target, otherClinicId)).toBe(false);
      expect(logAudit).not.toHaveBeenCalled();
    } finally {
      await purgeClinic(otherClinicId);
    }
  });

  it("GET /api/users/me includes seniorDoctorEligible:false for a fresh vet (RN gate reads the identity payload)", async () => {
    const vetId = randomUUID();
    await seedUser(vetId, clinicId, { name: "Dr. Fresh Vet", role: "vet" });

    setActor(vetId, "vet");
    const res = await api(`/api/users/me`, "GET");

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(res.json.seniorDoctorEligible).toBe(false);
  });

  it("GET /api/users/me reflects seniorDoctorEligible:true after the admin grant", async () => {
    const vetId = randomUUID();
    await seedUser(vetId, clinicId, { name: "Dr. Eligible Vet", role: "vet", seniorDoctorEligible: true });

    setActor(vetId, "vet");
    const res = await api(`/api/users/me`, "GET");

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(res.json.seniorDoctorEligible).toBe(true);
  });
});
