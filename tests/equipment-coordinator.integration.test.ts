/**
 * Docking P3 T3.4-i-a (server) — Equipment Coordinator eligibility flag +
 * resolveShiftCoordinator (auto / senior-confirm / fallback / needs-confirmation)
 * + endpoints — Postgres integration tests.
 *
 * Covers:
 *  - GET /api/docking/coordinator: derives the shift's Equipment Coordinator
 *    from roster ∩ eligibility, matching `vt_shifts.employeeName` to
 *    `vt_users` by the SAME normalized-name key role-resolution.ts's
 *    shift-match uses (reused via exported normalizeName/normalizeNameKey).
 *  - POST /api/docking/coordinator: confirms an ambiguous (multi-eligible)
 *    shift's coordinator; caller must be that shift's senior tech or an
 *    admin; the pick must be in the eligible-on-shift set (else 422).
 *  - PATCH /api/users/:id/equipment-coordinator: admin sets/clears the
 *    static `is_equipment_coordinator` eligibility flag; audited.
 *
 * Requires DATABASE_URL and migration 166 (vt_users.is_equipment_coordinator
 * + vt_shift_equipment_coordinator).
 * Run: pnpm test tests/equipment-coordinator.integration.test.ts
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
    req.authUser = { id: currentUserId, email: `${currentUserId}@ops.local`, role: currentUserRole };
    req.clinicId = currentClinicId;
    next();
  },
  requireAuthAny: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: currentUserId, email: `${currentUserId}@ops.local`, role: currentUserRole };
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

const dockingRoutes = (await import("../server/routes/docking.js")).default;
const usersRoutes = (await import("../server/routes/users.js")).default;
const { logAudit } = (await import("../server/lib/audit.js")) as unknown as { logAudit: ReturnType<typeof vi.fn> };
const { resolveShiftCoordinator } = await import("../server/services/equipment-coordinator.service.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", i18nMiddleware);
  app.use("/api/docking", dockingRoutes);
  app.use("/api/users", usersRoutes);
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

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
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
  opts: { name: string; role?: string; isEquipmentCoordinator?: boolean },
) {
  await requireProbePool().query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, display_name, role, status, preferred_locale, is_equipment_coordinator)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'active', 'en', $7)
     ON CONFLICT DO NOTHING`,
    [userId, clinicId, `clerk_${randomUUID()}`, `${userId}@ops.local`, opts.name, opts.role ?? "technician", opts.isEquipmentCoordinator ?? false],
  );
}

async function seedShift(
  shiftId: string,
  clinicId: string,
  date: string,
  employeeName: string,
  role: "technician" | "senior_technician" | "admin",
  startTime = "08:00:00",
  endTime = "16:00:00",
) {
  await requireProbePool().query(
    `INSERT INTO vt_shifts (id, clinic_id, date, start_time, end_time, employee_name, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [shiftId, clinicId, date, startTime, endTime, employeeName, role],
  );
}

async function isEquipmentCoordinatorFlag(userId: string): Promise<boolean> {
  const { rows } = await requireProbePool().query<{ is_equipment_coordinator: boolean }>(
    `SELECT is_equipment_coordinator FROM vt_users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.is_equipment_coordinator === true;
}

async function purgeClinic(clinicId: string) {
  const P = requireProbePool();
  await P.query(`DELETE FROM vt_shift_equipment_coordinator WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_shifts WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

interface Ctx {
  clinicId: string;
  shiftDate: string;
}

let ctx: Ctx;

describe.skipIf(!DATABASE_URL)("docking equipment coordinator (T3.4-i-a) integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL required");
    }

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

    try {
      await probePool.query("SELECT 1");
      const { rows } = await probePool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'vt_shift_equipment_coordinator'`,
      );
      if (rows.length !== 1) {
        throw new Error("vt_shift_equipment_coordinator table missing (migration 166 not applied?)");
      }
      const { rows: colRows } = await probePool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'vt_users' AND column_name = 'is_equipment_coordinator'`,
      );
      if (colRows.length !== 1) {
        throw new Error("vt_users.is_equipment_coordinator column missing (migration 166 not applied?)");
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
    ctx = { clinicId: randomUUID(), shiftDate: "2026-02-02" };
    currentClinicId = ctx.clinicId;
    setActor(randomUUID(), "admin");
    await seedClinic(ctx.clinicId);
    logAudit.mockClear();
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await requireProbePool().query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  it("case 1: ONE eligible coordinator on shift -> status auto, that user", async () => {
    const eligible = randomUUID();
    const nonEligible = randomUUID();
    await seedUser(eligible, ctx.clinicId, { name: "Dana Cohen", isEquipmentCoordinator: true });
    await seedUser(nonEligible, ctx.clinicId, { name: "Noam Levi", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Dana Cohen", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Noam Levi", "technician");

    const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");

    expect(res.status).toBe(200);
    expect(isRecord(res.json)).toBe(true);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(getString(res.json, "status")).toBe("auto");
    expect(getString(res.json, "coordinatorUserId")).toBe(eligible);
    expect(getString(res.json, "coordinatorName")).toBe("Dana Cohen");
    const candidates = asRecordArray(res.json.candidates);
    expect(candidates.map((c) => c.userId)).toEqual([eligible]);
  });

  it("case 2: ZERO eligible, a senior tech on shift -> status fallback_senior, the senior", async () => {
    const tech = randomUUID();
    const senior = randomUUID();
    await seedUser(tech, ctx.clinicId, { name: "Omer Peretz", role: "technician", isEquipmentCoordinator: false });
    await seedUser(senior, ctx.clinicId, { name: "Shira Katz", role: "senior_technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Omer Peretz", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Shira Katz", "senior_technician");

    const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(getString(res.json, "status")).toBe("fallback_senior");
    expect(getString(res.json, "coordinatorUserId")).toBe(senior);
    expect(getString(res.json, "seniorTechUserId")).toBe(senior);
    expect((res.json.candidates as unknown[]).length).toBe(0);
  });

  it("case 2b: ZERO eligible, no senior tech either -> status unresolved, null coordinator", async () => {
    const tech = randomUUID();
    await seedUser(tech, ctx.clinicId, { name: "Yael Bar", role: "technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Yael Bar", "technician");

    const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(getString(res.json, "status")).toBe("unresolved");
    expect(res.json.coordinatorUserId).toBeNull();
    expect(res.json.seniorTechUserId).toBeNull();
  });

  it("case 3: MULTIPLE eligible, no stored row -> needs_confirmation, both candidates, null coordinator", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await seedUser(a, ctx.clinicId, { name: "Amit Ron", isEquipmentCoordinator: true });
    await seedUser(b, ctx.clinicId, { name: "Tamar Gil", isEquipmentCoordinator: true });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Ron", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Tamar Gil", "technician");

    const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(getString(res.json, "status")).toBe("needs_confirmation");
    expect(res.json.coordinatorUserId).toBeNull();
    const candidateIds = (asRecordArray(res.json.candidates)).map((c) => c.userId).sort();
    expect(candidateIds).toEqual([a, b].sort());
  });

  it("case 3b (CRITICAL, pre-PR review): a stored row from the escalation worker (source fallback_senior, NOT confirmed) must not be treated as a human confirmation", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const senior = randomUUID();
    await seedUser(a, ctx.clinicId, { name: "Amit Ron", isEquipmentCoordinator: true });
    await seedUser(b, ctx.clinicId, { name: "Tamar Gil", isEquipmentCoordinator: true });
    await seedUser(senior, ctx.clinicId, { name: "Shira Katz", role: "senior_technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Ron", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Tamar Gil", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Shira Katz", "senior_technician");

    // Simulate the sweep-escalation worker having already written a
    // bookkeeping row for this needs_confirmation shift (I-2 ladder,
    // source "fallback_senior") — NOT a genuine human confirmation.
    await requireProbePool().query(
      `INSERT INTO vt_shift_equipment_coordinator
         (id, clinic_id, shift_date, coordinator_user_id, source, escalation_stage, current_responsible_user_id, escalated_at)
       VALUES ($1, $2, $3, $4, 'fallback_senior', 2, $4, now())`,
      [randomUUID(), ctx.clinicId, ctx.shiftDate, senior],
    );

    const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
    expect(resolution.status).toBe("needs_confirmation");
    expect(resolution.coordinatorUserId).toBeNull();

    // The HTTP GET must reflect the same re-derived status, so the
    // manager's confirm picker (CoordinatorSweepState.tsx) stays visible.
    const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");
    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(getString(res.json, "status")).toBe("needs_confirmation");
    expect(res.json.coordinatorUserId).toBeNull();
  });

  it("case 3c (CRITICAL, pre-PR review): a stored row with source confirmed IS a genuine human confirmation -> status confirmed", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await seedUser(a, ctx.clinicId, { name: "Amit Ron", isEquipmentCoordinator: true });
    await seedUser(b, ctx.clinicId, { name: "Tamar Gil", isEquipmentCoordinator: true });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Ron", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Tamar Gil", "technician");

    await requireProbePool().query(
      `INSERT INTO vt_shift_equipment_coordinator (id, clinic_id, shift_date, coordinator_user_id, source)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [randomUUID(), ctx.clinicId, ctx.shiftDate, a],
    );

    const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
    expect(resolution.status).toBe("confirmed");
    expect(resolution.coordinatorUserId).toBe(a);
  });

  it("case 4b (MAJOR, pre-PR review, security): a plain technician whose self-editable displayName matches the roster's senior employeeName must NOT pass the senior-tech gate", async () => {
    const a = randomUUID();
    const impersonator = randomUUID();
    await seedUser(a, ctx.clinicId, { name: "Amit Ron", isEquipmentCoordinator: true });
    // Permanent role is "technician" — this user is NOT actually a senior
    // tech. Their displayName has been self-edited (PATCH /api/users/:id/display_name
    // is user-editable) to match the roster's senior_technician employeeName
    // for this shift-date, so `matchOnShiftUsers`/`isSeniorTech` derive them
    // as `seniorTechUserId` from the roster row alone.
    await seedUser(impersonator, ctx.clinicId, { name: "Shira Katz", role: "technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Ron", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Shira Katz", "senior_technician");

    // Sanity: the resolver really does derive this user as seniorTechUserId.
    const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
    expect(resolution.seniorTechUserId).toBe(impersonator);

    // The caller's OWN permanent DB role is "technician" — the gate must
    // reject them even though they are the derived seniorTechUserId.
    setActor(impersonator, "technician");
    const res = await api("/api/docking/coordinator", "POST", { shiftDate: ctx.shiftDate, coordinatorUserId: a });
    expect(res.status).toBe(403);
  });

  it("case 4: POST confirm as the senior tech picks an eligible candidate -> confirmed; a non-eligible pick -> 422", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const senior = randomUUID();
    await seedUser(a, ctx.clinicId, { name: "Amit Ron", isEquipmentCoordinator: true });
    await seedUser(b, ctx.clinicId, { name: "Tamar Gil", isEquipmentCoordinator: true });
    await seedUser(senior, ctx.clinicId, { name: "Shira Katz", role: "senior_technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Ron", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Tamar Gil", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Shira Katz", "senior_technician");

    // A non-senior, non-admin caller is forbidden.
    setActor(a, "technician");
    const forbidden = await api("/api/docking/coordinator", "POST", { shiftDate: ctx.shiftDate, coordinatorUserId: a });
    expect(forbidden.status).toBe(403);

    // The senior tech on this shift confirms an eligible candidate.
    setActor(senior, "senior_technician");
    const confirmRes = await api("/api/docking/coordinator", "POST", { shiftDate: ctx.shiftDate, coordinatorUserId: b });
    expect(confirmRes.status).toBe(200);
    if (!isRecord(confirmRes.json)) throw new Error("expected object");
    expect(getString(confirmRes.json, "coordinatorUserId")).toBe(b);
    expect(getString(confirmRes.json, "source")).toBe("confirmed");

    const getRes = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");
    if (!isRecord(getRes.json)) throw new Error("expected object");
    expect(getString(getRes.json, "status")).toBe("confirmed");
    expect(getString(getRes.json, "coordinatorUserId")).toBe(b);

    expect(logAudit).toHaveBeenCalledTimes(1);
    const call = logAudit.mock.calls[0]?.[0] as unknown;
    if (!isRecord(call)) throw new Error("expected object");
    expect(call.actionType).toBe("equipment_coordinator_assigned");
    expect(call.targetId).toBe(b);

    // A non-eligible pick (senior, who is on shift but not eligible) is rejected.
    const rejectRes = await api("/api/docking/coordinator", "POST", { shiftDate: ctx.shiftDate, coordinatorUserId: senior });
    expect(rejectRes.status).toBe(422);
  });

  it("case 5: PATCH eligibility flips is_equipment_coordinator (admin) and writes an audit row", async () => {
    const target = randomUUID();
    await seedUser(target, ctx.clinicId, { name: "Roni Adar", isEquipmentCoordinator: false });

    setActor(randomUUID(), "admin");
    const res = await api(`/api/users/${target}/equipment-coordinator`, "PATCH", { isEquipmentCoordinator: true });

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(res.json.isEquipmentCoordinator).toBe(true);
    expect(await isEquipmentCoordinatorFlag(target)).toBe(true);

    expect(logAudit).toHaveBeenCalledTimes(1);
    const call = logAudit.mock.calls[0]?.[0] as unknown;
    if (!isRecord(call)) throw new Error("expected object");
    expect(call.actionType).toBe("equipment_coordinator_eligibility_set");
    expect(call.targetId).toBe(target);
    expect(isRecord(call.metadata) && (call.metadata as Record<string, unknown>).isEquipmentCoordinator).toBe(true);
  });

  it("case 6: a shift employeeName with different casing/spacing than the user's name still matches", async () => {
    const userId = randomUUID();
    await seedUser(userId, ctx.clinicId, { name: "Dana Cohen", isEquipmentCoordinator: true });
    // Extra whitespace, different casing, hyphen — must still resolve to the same normalized key.
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "  dana-COHEN  ", "technician");

    const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");

    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    expect(getString(res.json, "status")).toBe("auto");
    expect(getString(res.json, "coordinatorUserId")).toBe(userId);
  });

  it("case 7 (M-2, phase review): reconfirming mid-escalation resets escalation_stage/current_responsible_user_id/escalated_at", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const senior = randomUUID();
    await seedUser(a, ctx.clinicId, { name: "Amit Ron", isEquipmentCoordinator: true });
    await seedUser(b, ctx.clinicId, { name: "Tamar Gil", isEquipmentCoordinator: true });
    await seedUser(senior, ctx.clinicId, { name: "Shira Katz", role: "senior_technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Ron", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Tamar Gil", "technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Shira Katz", "senior_technician");

    setActor(senior, "senior_technician");
    const first = await api("/api/docking/coordinator", "POST", { shiftDate: ctx.shiftDate, coordinatorUserId: a });
    expect(first.status).toBe(200);

    // Simulate the sweep-escalation worker having already advanced this
    // shift's ladder for the first coordinator (a).
    await requireProbePool().query(
      `UPDATE vt_shift_equipment_coordinator
       SET escalation_stage = 3, current_responsible_user_id = $1, escalated_at = now()
       WHERE clinic_id = $2 AND shift_date = $3`,
      [senior, ctx.clinicId, ctx.shiftDate],
    );
    const { rows: midRows } = await requireProbePool().query<{ escalation_stage: number }>(
      `SELECT escalation_stage FROM vt_shift_equipment_coordinator WHERE clinic_id = $1 AND shift_date = $2`,
      [ctx.clinicId, ctx.shiftDate],
    );
    expect(midRows[0]?.escalation_stage).toBe(3);

    // Reconfirming (a different eligible pick, b) must reset the ladder.
    const second = await api("/api/docking/coordinator", "POST", { shiftDate: ctx.shiftDate, coordinatorUserId: b });
    expect(second.status).toBe(200);
    if (!isRecord(second.json)) throw new Error("expected object");
    expect(getString(second.json, "coordinatorUserId")).toBe(b);

    const { rows } = await requireProbePool().query<{
      escalation_stage: number;
      current_responsible_user_id: string | null;
      escalated_at: Date | null;
      coordinator_user_id: string;
    }>(
      `SELECT escalation_stage, current_responsible_user_id, escalated_at, coordinator_user_id
       FROM vt_shift_equipment_coordinator WHERE clinic_id = $1 AND shift_date = $2`,
      [ctx.clinicId, ctx.shiftDate],
    );
    expect(rows[0]?.coordinator_user_id).toBe(b);
    expect(rows[0]?.escalation_stage).toBe(0);
    expect(rows[0]?.current_responsible_user_id).toBeNull();
    expect(rows[0]?.escalated_at).toBeNull();
  });

  it("uses resolveShiftCoordinator directly against the same DB (service-level sanity)", async () => {
    const eligible = randomUUID();
    await seedUser(eligible, ctx.clinicId, { name: "Direct Call", isEquipmentCoordinator: true });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Direct Call", "technician");

    const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
    expect(resolution.status).toBe("auto");
    expect(resolution.coordinatorUserId).toBe(eligible);
  });

  it("S2-9 (cross-clinic isolation): a same-named eligible user + shift in a second clinic must not leak into clinic A's resolveShiftCoordinator name-matching", async () => {
    const clinicAEligible = randomUUID();
    const clinicBId = randomUUID();
    const clinicBEligible = randomUUID();

    await seedUser(clinicAEligible, ctx.clinicId, { name: "Dana Cohen", isEquipmentCoordinator: true });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Dana Cohen", "technician");

    await seedClinic(clinicBId);
    await seedUser(clinicBEligible, clinicBId, { name: "Dana Cohen", isEquipmentCoordinator: true });
    await seedShift(randomUUID(), clinicBId, ctx.shiftDate, "Dana Cohen", "technician");

    try {
      const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
      expect(resolution.status).toBe("auto");
      expect(resolution.coordinatorUserId).toBe(clinicAEligible);
      expect(resolution.candidates.map((c) => c.userId)).toEqual([clinicAEligible]);

      const res = await api(`/api/docking/coordinator?date=${ctx.shiftDate}`, "GET");
      expect(res.status).toBe(200);
      if (!isRecord(res.json)) throw new Error("expected object");
      expect(getString(res.json, "coordinatorUserId")).toBe(clinicAEligible);
      const candidates = asRecordArray(res.json.candidates);
      expect(candidates.map((c) => c.userId)).toEqual([clinicAEligible]);
    } finally {
      await purgeClinic(clinicBId);
    }
  });

  it("S2-12a: two senior techs on one shift -> seniorTechUserId is the alphabetically-first (deterministic tie-break)", async () => {
    const seniorZohar = randomUUID();
    const seniorAmit = randomUUID();
    await seedUser(seniorZohar, ctx.clinicId, { name: "Zohar Ben", role: "senior_technician", isEquipmentCoordinator: false });
    await seedUser(seniorAmit, ctx.clinicId, { name: "Amit Cohen", role: "senior_technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Zohar Ben", "senior_technician");
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Amit Cohen", "senior_technician");

    const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
    expect(resolution.seniorTechUserId).toBe(seniorAmit); // "Amit Cohen" < "Zohar Ben"
  });

  it("S2-12b: a user with permanent role lead_technician but a non-senior shift role still resolves as seniorTechUserId (mapLegacyRoleToClinicalRole alias)", async () => {
    const userId = randomUUID();
    await seedUser(userId, ctx.clinicId, { name: "Lead Tech", role: "lead_technician", isEquipmentCoordinator: false });
    // Shift role is plain "technician" — only the PERMANENT vt_users.role
    // (lead_technician, aliased to senior_technician) makes them the senior.
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Lead Tech", "technician");

    const resolution = await resolveShiftCoordinator(ctx.clinicId, ctx.shiftDate);
    expect(resolution.seniorTechUserId).toBe(userId);
  });

  it("A1-3 (CodeRabbit): GET /coordinator?date=2026-13-40 (well-formed but impossible calendar date) -> 400 before any DB query", async () => {
    const res = await api(`/api/docking/coordinator?date=2026-13-40`, "GET");
    expect(res.status).toBe(400);
  });

  it("A1-3 (CodeRabbit): GET /coordinator?date=2026-02-30 (Feb 30) -> 400", async () => {
    const res = await api(`/api/docking/coordinator?date=2026-02-30`, "GET");
    expect(res.status).toBe(400);
  });

  it("A1-3 (CodeRabbit): POST /coordinator with an impossible calendar date -> 400", async () => {
    setActor(randomUUID(), "admin");
    const res = await api("/api/docking/coordinator", "POST", {
      shiftDate: "2026-13-40",
      coordinatorUserId: randomUUID(),
    });
    expect(res.status).toBe(400);
  });

  it("A1-5 (CodeRabbit): GET /api/users admin list carries isEquipmentCoordinator reflecting persisted state", async () => {
    const eligible = randomUUID();
    const nonEligible = randomUUID();
    await seedUser(eligible, ctx.clinicId, { name: "Coord Eligible", role: "technician", isEquipmentCoordinator: true });
    await seedUser(nonEligible, ctx.clinicId, { name: "Coord None", role: "technician", isEquipmentCoordinator: false });

    setActor(randomUUID(), "admin");
    const res = await api(`/api/users`, "GET");
    expect(res.status).toBe(200);
    if (!isRecord(res.json)) throw new Error("expected object");
    const items = asRecordArray(res.json.items);
    const eligibleItem = items.find((u) => u.id === eligible);
    const nonEligibleItem = items.find((u) => u.id === nonEligible);
    expect(eligibleItem?.isEquipmentCoordinator).toBe(true);
    expect(nonEligibleItem?.isEquipmentCoordinator).toBe(false);
  });

  it("S2-14: PATCH /api/users/:id/equipment-coordinator as a non-admin actor -> 403", async () => {
    const target = randomUUID();
    await seedUser(target, ctx.clinicId, { name: "Roni Adar", isEquipmentCoordinator: false });

    setActor(randomUUID(), "technician");
    const res = await api(`/api/users/${target}/equipment-coordinator`, "PATCH", { isEquipmentCoordinator: true });

    expect(res.status).toBe(403);
    expect(await isEquipmentCoordinatorFlag(target)).toBe(false);
  });
});
