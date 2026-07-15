/**
 * Docking P3 T3.4-ii — Room Sweep escalation ladder.
 *
 * Part 1: pure `computeEscalationStage` unit cases (no DB — imports the
 * dependency-free server/services/sweep-escalation-stage.ts directly).
 *
 * Part 2: Postgres integration test for `runSweepEscalation` +
 * `isShiftSweepComplete`. Self-skipping (mirrors tests/equipment-coordinator.integration.test.ts
 * and tests/equipment-anchor.service.integration.test.ts): requires
 * DATABASE_URL and migration 167 (vt_shift_equipment_coordinator.escalation_stage
 * / current_responsible_user_id / escalated_at).
 * Run: pnpm test tests/sweep-escalation.test.ts
 */

import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { computeEscalationStage, DEFAULT_ESCALATION_THRESHOLDS } from "../server/services/sweep-escalation-stage.js";

describe("computeEscalationStage (pure, no DB)", () => {
  it("70 minutes to end -> stage 0 (no escalation yet)", () => {
    expect(computeEscalationStage(70)).toBe(0);
  });

  it("60 minutes to end (boundary, A2-1 inclusive) -> stage 1", () => {
    expect(computeEscalationStage(60)).toBe(1);
  });

  it("50 minutes to end -> stage 1 (coordinator reminded)", () => {
    expect(computeEscalationStage(50)).toBe(1);
  });

  it("40 minutes to end (boundary, A2-1 inclusive) -> stage 2", () => {
    expect(computeEscalationStage(40)).toBe(2);
  });

  it("30 minutes to end -> stage 2 (senior notified)", () => {
    expect(computeEscalationStage(30)).toBe(2);
  });

  it("20 minutes to end (boundary, A2-1 inclusive) -> stage 3", () => {
    expect(computeEscalationStage(20)).toBe(3);
  });

  it("10 minutes to end -> stage 3 (responsibility transferred)", () => {
    expect(computeEscalationStage(10)).toBe(3);
  });

  it("0 minutes to end (shift-end) -> stage 4 (open to all + manager)", () => {
    expect(computeEscalationStage(0)).toBe(4);
  });

  it("-5 minutes (past shift-end) -> stage 4", () => {
    expect(computeEscalationStage(-5)).toBe(4);
  });

  it("respects custom tunable thresholds", () => {
    const thresholds = { s1: 30, s2: 20, s3: 10, s4: 0 };
    expect(computeEscalationStage(35, thresholds)).toBe(0);
    expect(computeEscalationStage(25, thresholds)).toBe(1);
    expect(computeEscalationStage(15, thresholds)).toBe(2);
    expect(computeEscalationStage(5, thresholds)).toBe(3);
    expect(computeEscalationStage(0, thresholds)).toBe(4);
  });

  it("defaults to the owner-confirmed 60/40/20/0 thresholds", () => {
    expect(DEFAULT_ESCALATION_THRESHOLDS).toEqual({ s1: 60, s2: 40, s3: 20, s4: 0 });
  });
});

// ─── Postgres integration (self-skipping) ──────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;

vi.mock("../server/lib/push.js", () => ({
  sendPushToUser: vi.fn().mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 }),
  sendPushToRole: vi.fn().mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 }),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
}));

// A2-4/A2-5 (startSweepEscalationWorker startup path) — mocked so the
// BullMQ-queue branch is reachable without a real Redis/BullMQ instance.
// Unused by every other test in this file (which only calls
// runSweepEscalation, never startSweepEscalationWorker).
vi.mock("../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn().mockResolvedValue(null),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
}));

// Deferred until beforeAll (after the DATABASE_URL guard) so an unset
// DATABASE_URL never forces server/db.js to construct a connection pool at
// module-import time — mirrors tests/equipment-anchor.service.integration.test.ts.
type WorkerModule = typeof import("../server/workers/sweep-escalation.worker.js");
type ServiceModule = typeof import("../server/services/sweep-escalation.service.js");
type PushModule = typeof import("../server/lib/push.js");
type AuditModule = typeof import("../server/lib/audit.js");
type MetricsModule = typeof import("../server/lib/metrics.js");

let runSweepEscalation: WorkerModule["runSweepEscalation"];
let isShiftSweepComplete: ServiceModule["isShiftSweepComplete"];
let sendPushToUser: PushModule["sendPushToUser"];
let sendPushToRole: PushModule["sendPushToRole"];
let logAudit: AuditModule["logAudit"];
let incrementMetric: MetricsModule["incrementMetric"];
let workerTestExports: WorkerModule["__test"];
let startSweepEscalationWorker: WorkerModule["startSweepEscalationWorker"];

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(
  userId: string,
  clinicId: string,
  opts: { name: string; role?: string; isEquipmentCoordinator?: boolean; preferredLocale?: "en" | "he" },
) {
  await probePool!.query(
    `INSERT INTO vt_users (id, clinic_id, clerk_id, email, name, display_name, role, status, preferred_locale, is_equipment_coordinator)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'active', $7, $8)
     ON CONFLICT DO NOTHING`,
    [
      userId,
      clinicId,
      `clerk_${randomUUID()}`,
      `${userId}@ops.local`,
      opts.name,
      opts.role ?? "technician",
      opts.preferredLocale ?? "en",
      opts.isEquipmentCoordinator ?? false,
    ],
  );
}

async function seedShift(
  shiftId: string,
  clinicId: string,
  date: string,
  employeeName: string,
  role: "technician" | "senior_technician" | "admin",
  startTime: string,
  endTime: string,
) {
  await probePool!.query(
    `INSERT INTO vt_shifts (id, clinic_id, date, start_time, end_time, employee_name, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [shiftId, clinicId, date, startTime, endTime, employeeName, role],
  );
}

async function seedRoom(roomId: string, clinicId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_rooms (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [roomId, clinicId, name],
  );
}

async function seedHomedEquipment(equipmentId: string, clinicId: string, homeRoomId: string, name: string) {
  await probePool!.query(
    `INSERT INTO vt_equipment (id, clinic_id, name, home_room_id, status, version)
     VALUES ($1, $2, $3, $4, 'ok', 1)`,
    [equipmentId, clinicId, name, homeRoomId],
  );
}

async function seedSweepAnchor(
  anchorId: string,
  clinicId: string,
  equipmentId: string,
  roomId: string,
  assertedAt: Date,
) {
  await probePool!.query(
    `INSERT INTO vt_equipment_anchors (id, clinic_id, equipment_id, room_id, source, asserted_at)
     VALUES ($1, $2, $3, $4, 'sweep', $5)`,
    [anchorId, clinicId, equipmentId, roomId, assertedAt.toISOString()],
  );
}

/**
 * A2-7: mirrors the "never-anchored, unconfirmed" branch docking.ts's
 * sweep-commit writes (A1-1) — an already-invalidated `sweep_missing`
 * marker row with no room/dock (the item was never anchored at all).
 */
async function seedSweepMissingAnchor(
  anchorId: string,
  clinicId: string,
  equipmentId: string,
  assertedById: string,
  invalidatedAt: Date,
) {
  await probePool!.query(
    `INSERT INTO vt_equipment_anchors (id, clinic_id, equipment_id, room_id, dock_id, asserted_by_id, source, invalidated_at, invalidated_reason)
     VALUES ($1, $2, $3, NULL, NULL, $4, 'sweep', $5, 'sweep_missing')`,
    [anchorId, clinicId, equipmentId, assertedById, invalidatedAt.toISOString()],
  );
}

interface CoordinatorRow {
  escalation_stage: number;
  current_responsible_user_id: string | null;
  escalated_at: Date | null;
  coordinator_user_id: string;
  source: string;
}

async function getCoordinatorRow(clinicId: string, shiftDate: string): Promise<CoordinatorRow | null> {
  const { rows } = await probePool!.query<CoordinatorRow>(
    `SELECT escalation_stage, current_responsible_user_id, escalated_at, coordinator_user_id, source
     FROM vt_shift_equipment_coordinator WHERE clinic_id = $1 AND shift_date = $2`,
    [clinicId, shiftDate],
  );
  return rows[0] ?? null;
}

async function purgeClinic(clinicId: string) {
  const P = probePool!;
  await P.query(`DELETE FROM vt_equipment_anchors WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_shift_equipment_coordinator WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_shifts WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
  await P.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
}

interface Ctx {
  clinicId: string;
  shiftDate: string;
  coordinatorId: string;
  seniorId: string;
  roomAId: string;
  roomBId: string;
  itemAId: string;
  itemBId: string;
}
let ctx: Ctx;

/** Local-time construction (no timezone lib) — same frame the worker itself uses. */
function localDateTime(y: number, m: number, d: number, h: number, mi: number): Date {
  return new Date(y, m - 1, d, h, mi, 0, 0);
}

const SHIFT_DATE = "2026-02-02";
const SHIFT_START = "08:00:00";
const SHIFT_END = "18:00:00";
const SHIFT_START_DT = localDateTime(2026, 2, 2, 8, 0);

describe.skipIf(!DATABASE_URL)("sweep-escalation (P3 T3.4-ii) integration", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL required");

    probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });

    try {
      await probePool.query("SELECT 1");
      const { rows } = await probePool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'vt_shift_equipment_coordinator'
           AND column_name IN ('escalation_stage', 'current_responsible_user_id', 'escalated_at')`,
      );
      if (rows.length !== 3) {
        throw new Error("vt_shift_equipment_coordinator escalation columns missing (migration 167 not applied?)");
      }
    } catch (err) {
      if (probePool) {
        await probePool.end();
        probePool = null;
      }
      throw new Error(`Database connection or schema validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    ({ runSweepEscalation, __test: workerTestExports, startSweepEscalationWorker } = await import(
      "../server/workers/sweep-escalation.worker.js"
    ));
    ({ isShiftSweepComplete } = await import("../server/services/sweep-escalation.service.js"));
    ({ sendPushToUser, sendPushToRole } = await import("../server/lib/push.js"));
    ({ logAudit } = await import("../server/lib/audit.js"));
    ({ incrementMetric } = await import("../server/lib/metrics.js"));
  });

  afterAll(async () => {
    if (probePool) {
      await probePool.end();
      probePool = null;
    }
  });

  beforeEach(async () => {
    ctx = {
      clinicId: randomUUID(),
      shiftDate: SHIFT_DATE,
      coordinatorId: randomUUID(),
      seniorId: randomUUID(),
      roomAId: randomUUID(),
      roomBId: randomUUID(),
      itemAId: randomUUID(),
      itemBId: randomUUID(),
    };
    vi.clearAllMocks();
    vi.mocked(sendPushToUser).mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 });
    vi.mocked(sendPushToRole).mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 });

    await seedClinic(ctx.clinicId);
    await seedUser(ctx.coordinatorId, ctx.clinicId, { name: "Dana Cohen", role: "technician", isEquipmentCoordinator: true });
    await seedUser(ctx.seniorId, ctx.clinicId, { name: "Shira Katz", role: "senior_technician", isEquipmentCoordinator: false });
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Dana Cohen", "technician", SHIFT_START, SHIFT_END);
    await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Shira Katz", "senior_technician", SHIFT_START, SHIFT_END);
    await seedRoom(ctx.roomAId, ctx.clinicId, "Room A");
    await seedRoom(ctx.roomBId, ctx.clinicId, "Room B");
    await seedHomedEquipment(ctx.itemAId, ctx.clinicId, ctx.roomAId, "Pump A");
    await seedHomedEquipment(ctx.itemBId, ctx.clinicId, ctx.roomBId, "Pump B");
  });

  afterEach(async () => {
    await purgeClinic(ctx.clinicId);
  });

  it("confirms the DB was actually reached (sanity)", async () => {
    const { rows } = await probePool!.query("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  it("isShiftSweepComplete: false when homed rooms have no sweep anchor in-window; true once both are swept", async () => {
    const now = localDateTime(2026, 2, 2, 17, 30);
    await expect(isShiftSweepComplete(ctx.clinicId, { shiftStart: SHIFT_START_DT, now })).resolves.toBe(false);

    await seedSweepAnchor(randomUUID(), ctx.clinicId, ctx.itemAId, ctx.roomAId, localDateTime(2026, 2, 2, 9, 0));
    await expect(isShiftSweepComplete(ctx.clinicId, { shiftStart: SHIFT_START_DT, now })).resolves.toBe(false);

    await seedSweepAnchor(randomUUID(), ctx.clinicId, ctx.itemBId, ctx.roomBId, localDateTime(2026, 2, 2, 9, 5));
    await expect(isShiftSweepComplete(ctx.clinicId, { shiftStart: SHIFT_START_DT, now })).resolves.toBe(true);
  });

  it("minutes-to-end=30, no sweep -> escalates straight to stage 2 (senior notified), does not advance past 2 on a same-stage rerun", async () => {
    const now30 = localDateTime(2026, 2, 2, 17, 30); // 18:00 end - 17:30 now = 30 min

    const result = await runSweepEscalation(now30);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(2);
    expect(row?.current_responsible_user_id).toBeNull();
    expect(row?.coordinator_user_id).toBe(ctx.coordinatorId);
    expect(row?.source).toBe("auto");

    expect(sendPushToUser).toHaveBeenCalledWith(ctx.clinicId, ctx.seniorId, expect.any(Object));
    expect(sendPushToUser).not.toHaveBeenCalledWith(ctx.clinicId, ctx.coordinatorId, expect.any(Object));
    expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_2_fired");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: ctx.clinicId, actionType: "room_sweep_escalated", metadata: expect.objectContaining({ stage: 2 }) }),
    );

    // Idempotent rerun at the SAME now: no re-fire, no new push, stage unchanged.
    const pushCallsBefore = vi.mocked(sendPushToUser).mock.calls.length;
    const rerun = await runSweepEscalation(now30);
    expect(rerun.escalated).toBe(0);
    expect(vi.mocked(sendPushToUser).mock.calls.length).toBe(pushCallsBefore);
    const rowAfterRerun = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(rowAfterRerun?.escalation_stage).toBe(2);
  });

  it("minutes-to-end=10 -> stage 3, responsibility transferred to senior; second run at same stage is idempotent", async () => {
    const now30 = localDateTime(2026, 2, 2, 17, 30);
    await runSweepEscalation(now30); // reach stage 2 first

    const now10 = localDateTime(2026, 2, 2, 17, 50); // 18:00 end - 17:50 now = 10 min
    const result = await runSweepEscalation(now10);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(3);
    expect(row?.current_responsible_user_id).toBe(ctx.seniorId);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: ctx.clinicId,
        actionType: "room_sweep_responsibility_transferred",
        targetId: ctx.seniorId,
      }),
    );
    expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_3_fired");

    // Second run at the same now (same stage) -> idempotent, no re-fire.
    vi.mocked(logAudit).mockClear();
    vi.mocked(incrementMetric).mockClear();
    const rerun = await runSweepEscalation(now10);
    expect(rerun.escalated).toBe(0);
    expect(logAudit).not.toHaveBeenCalled();
    expect(incrementMetric).not.toHaveBeenCalled();
    const rowAfterRerun = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(rowAfterRerun?.escalation_stage).toBe(3);
    expect(rowAfterRerun?.current_responsible_user_id).toBe(ctx.seniorId);
  });

  it("sweeping both homed rooms in-window stops further escalation, even past shift-end", async () => {
    const now30 = localDateTime(2026, 2, 2, 17, 30);
    await runSweepEscalation(now30); // reach stage 2

    const now10 = localDateTime(2026, 2, 2, 17, 50);
    await runSweepEscalation(now10); // reach stage 3

    await seedSweepAnchor(randomUUID(), ctx.clinicId, ctx.itemAId, ctx.roomAId, localDateTime(2026, 2, 2, 17, 55));
    await seedSweepAnchor(randomUUID(), ctx.clinicId, ctx.itemBId, ctx.roomBId, localDateTime(2026, 2, 2, 17, 56));

    vi.mocked(sendPushToRole).mockClear();

    const now0 = localDateTime(2026, 2, 2, 18, 0); // shift-end -> would be stage 4 if incomplete
    const result = await runSweepEscalation(now0);
    expect(result.escalated).toBe(0);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(3); // never advanced to 4

    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  // ─── I-1 (phase review) — stage 4 post-end grace window ──────────────────
  //
  // Bug: the worker only scanned clinics with a STILL-ACTIVE shift
  // (`endTime > now` strict), and sourced the coordinator's own shift-end via
  // `resolveCurrentRole`, whose active-shift query is ALSO `endTime > now`
  // strict. At the instant `minutesToEnd` hits 0, the clinic has already
  // dropped out of BOTH gates — so `computeEscalationStage` never sees a
  // value <= 0, and stage 4 (open to all + manager notified) is unreachable
  // in production. Fix: (a) the candidate scan also includes shifts that
  // ended within the last SWEEP_INTERVAL_MS, and (b) the responsible
  // identity's shift-end is read directly from their own `vt_shifts` row
  // (normalized-name match), not through `resolveCurrentRole`'s gate.
  it("I-1: an incomplete sweep one tick past shift-end (within the grace window) reaches stage 4 and notifies the managers", async () => {
    const adminId = randomUUID();
    await seedUser(adminId, ctx.clinicId, { name: "Admin Manager", role: "admin" });

    // 18:00 SHIFT_END + 5 minutes — one tick past end, still comfortably
    // inside the (A2-3) bounded catch-up window, sweep still incomplete
    // (no anchors seeded for either homed room in this test's ctx).
    const pastEnd = localDateTime(2026, 2, 2, 18, 5);
    const result = await runSweepEscalation(pastEnd);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(4);
    expect(row?.current_responsible_user_id).toBeNull(); // stage 4 opens to all — no single responsible party

    // A2-2: stage 4 pushes each manager recipient individually (sendPushToUser),
    // not a role broadcast (sendPushToRole) — see the dedicated A2-2 test below
    // for the per-recipient-locale assertion.
    expect(sendPushToUser).toHaveBeenCalledWith(ctx.clinicId, adminId, expect.any(Object));
    expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_4_fired");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: ctx.clinicId,
        actionType: "room_sweep_escalated",
        metadata: expect.objectContaining({ stage: 4 }),
      }),
    );
  });

  it("A2-3: a shift ended ~2x the old (10-min) SWEEP_INTERVAL_MS ago is still a candidate under the new bounded catch-up window", async () => {
    // 18:00 SHIFT_END + 20 minutes — would have been OUTSIDE the pre-A2-3
    // 10-minute grace window, but is comfortably inside the new bounded
    // catch-up window (ESCALATION_CATCHUP_WINDOW_MS). Demonstrates the bug
    // A2-3 fixes: a scheduler/deploy gap longer than one tick must not
    // permanently drop the shift out of escalation.
    const wellPastEnd = localDateTime(2026, 2, 2, 18, 20);
    const result = await runSweepEscalation(wellPastEnd);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(4);
  });

  it("I-1/A2-3: a shift past the end of the bounded catch-up window is no longer a candidate", async () => {
    // 18:00 SHIFT_END + 5 hours — well beyond ESCALATION_CATCHUP_WINDOW_MS (4h).
    const wayPastEnd = localDateTime(2026, 2, 2, 23, 0);
    const result = await runSweepEscalation(wayPastEnd);
    expect(result.escalated).toBe(0);
    expect(result.shiftsChecked).toBe(0);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row).toBeNull();
  });

  // ─── S2-10 — stage-1 (coordinator-only reminder) ───────────────────────────
  it("S2-10: minutes-to-end=50 (raw stage 1), normal single-eligible-coordinator shift -> pushes the COORDINATOR, not the senior", async () => {
    const now50 = localDateTime(2026, 2, 2, 17, 10); // 18:00 end - 17:10 now = 50 min

    const result = await runSweepEscalation(now50);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(1);
    expect(row?.coordinator_user_id).toBe(ctx.coordinatorId);
    expect(row?.source).toBe("auto");

    expect(sendPushToUser).toHaveBeenCalledWith(ctx.clinicId, ctx.coordinatorId, expect.any(Object));
    expect(sendPushToUser).not.toHaveBeenCalledWith(ctx.clinicId, ctx.seniorId, expect.any(Object));
    expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_1_fired");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: ctx.clinicId,
        actionType: "room_sweep_escalated",
        metadata: expect.objectContaining({ stage: 1 }),
      }),
    );
  });

  // ─── S2-11 — coordinator-only shift (no senior on shift), stage 2/3 no-op ──
  describe("S2-11: coordinator-only shift (no senior tech on shift)", () => {
    beforeEach(async () => {
      // Remove the outer beforeEach's senior shift row — this shift has
      // ONLY the coordinator on it (the senior user still exists, but is
      // not matched as "on shift" without a roster row for this date).
      await probePool!.query(`DELETE FROM vt_shifts WHERE clinic_id = $1 AND employee_name = $2`, [
        ctx.clinicId,
        "Shira Katz",
      ]);
    });

    it("minutes-to-end=30 -> stage 2 still advances (row/metric/audit), but no senior push fires (if (seniorTechUserId) no-op)", async () => {
      const now30 = localDateTime(2026, 2, 2, 17, 30);
      const result = await runSweepEscalation(now30);
      expect(result.escalated).toBeGreaterThanOrEqual(1);

      const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
      expect(row?.escalation_stage).toBe(2);
      expect(row?.coordinator_user_id).toBe(ctx.coordinatorId);

      expect(sendPushToUser).not.toHaveBeenCalled();
      expect(sendPushToRole).not.toHaveBeenCalled();
      expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_2_fired");
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ clinicId: ctx.clinicId, actionType: "room_sweep_escalated", metadata: expect.objectContaining({ stage: 2 }) }),
      );
    });

    it("minutes-to-end=10 -> stage 3 still advances (row/metric/audit), current_responsible_user_id stays null, no senior push fires", async () => {
      const now30 = localDateTime(2026, 2, 2, 17, 30);
      await runSweepEscalation(now30); // reach stage 2 first

      const now10 = localDateTime(2026, 2, 2, 17, 50);
      const result = await runSweepEscalation(now10);
      expect(result.escalated).toBeGreaterThanOrEqual(1);

      const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
      expect(row?.escalation_stage).toBe(3);
      expect(row?.current_responsible_user_id).toBeNull(); // no senior to transfer to

      expect(sendPushToUser).not.toHaveBeenCalled();
      expect(sendPushToRole).not.toHaveBeenCalled();
      expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_3_fired");
      expect(logAudit).not.toHaveBeenCalledWith(
        expect.objectContaining({ actionType: "room_sweep_responsibility_transferred" }),
      );
    });
  });

  // ─── I-2 (phase review) — needs_confirmation still escalates to the senior ─
  //
  // Bug: `if (!resolution.coordinatorUserId) continue;` skipped BOTH
  // `unresolved` (correctly — nobody on shift at all) AND
  // `needs_confirmation` (multiple eligible techs, nobody confirmed) even
  // though `resolveShiftCoordinator` independently derives a
  // `seniorTechUserId` for the needs_confirmation case. So the
  // highest-risk, most-diffuse-accountability shift got ZERO escalation.
  // Fix: when status is `needs_confirmation` AND a senior is on shift, run
  // the ladder with the senior as the responsible identity, starting at
  // stage 2 (stage 1 — "remind the coordinator" — is skipped: there's no
  // single coordinator to remind).
  describe("I-2: needs_confirmation with a senior on shift", () => {
    let secondEligibleId: string;

    beforeEach(async () => {
      // A second eligible coordinator on the SAME shift flips
      // resolveShiftCoordinator's status from "auto" (ctx's default
      // single-eligible setup) to "needs_confirmation".
      secondEligibleId = randomUUID();
      await seedUser(secondEligibleId, ctx.clinicId, { name: "Noa Levi", role: "technician", isEquipmentCoordinator: true });
      await seedShift(randomUUID(), ctx.clinicId, ctx.shiftDate, "Noa Levi", "technician", SHIFT_START, SHIFT_END);
    });

    it("never fires stage 1 (no single coordinator to remind)", async () => {
      const now55 = localDateTime(2026, 2, 2, 17, 5); // 55 min to end -> raw stage 1 territory
      const result = await runSweepEscalation(now55);
      expect(result.escalated).toBe(0);
      const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
      expect(row).toBeNull();
    });

    it("notifies the senior at stage >= 2 even though nobody confirmed a coordinator", async () => {
      const now35 = localDateTime(2026, 2, 2, 17, 25); // 35 min to end -> stage 2
      const result = await runSweepEscalation(now35);
      expect(result.escalated).toBeGreaterThanOrEqual(1);

      const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
      expect(row?.escalation_stage).toBeGreaterThanOrEqual(2);
      expect(row?.coordinator_user_id).toBe(ctx.seniorId); // senior recorded as responsible
      expect(row?.source).toBe("fallback_senior");

      expect(sendPushToUser).toHaveBeenCalledWith(ctx.clinicId, ctx.seniorId, expect.any(Object));
      expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_2_fired");
    });

    it("transfers responsibility to the senior at stage 3", async () => {
      const now35 = localDateTime(2026, 2, 2, 17, 25); // 35 min to end -> stage 2
      await runSweepEscalation(now35);

      const now15 = localDateTime(2026, 2, 2, 17, 45); // 15 min to end -> stage 3
      const result = await runSweepEscalation(now15);
      expect(result.escalated).toBeGreaterThanOrEqual(1);

      const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
      expect(row?.escalation_stage).toBe(3);
      expect(row?.current_responsible_user_id).toBe(ctx.seniorId);
    });

    it("is idempotent — a rerun at the same stage does not re-fire", async () => {
      const now35 = localDateTime(2026, 2, 2, 17, 25);
      await runSweepEscalation(now35);
      const pushCallsBefore = vi.mocked(sendPushToUser).mock.calls.length;

      const rerun = await runSweepEscalation(now35);
      expect(rerun.escalated).toBe(0);
      expect(vi.mocked(sendPushToUser).mock.calls.length).toBe(pushCallsBefore);
    });
  });

  // ─── A2-2 (CodeRabbit PR #106) — stage 4 per-recipient locale ─────────────
  describe("A2-2: stage 4 resolves each manager recipient's OWN locale", () => {
    it("pushes an 'he' manager the Hebrew copy and an 'en' manager the English copy (not a shared default)", async () => {
      const heManagerId = randomUUID();
      const enManagerId = randomUUID();
      await seedUser(heManagerId, ctx.clinicId, { name: "Hebrew Admin", role: "admin", preferredLocale: "he" });
      await seedUser(enManagerId, ctx.clinicId, { name: "English Vet", role: "vet", preferredLocale: "en" });

      const pastEnd = localDateTime(2026, 2, 2, 18, 5); // one tick past shift-end -> stage 4
      const result = await runSweepEscalation(pastEnd);
      expect(result.escalated).toBeGreaterThanOrEqual(1);

      const heCopy = workerTestExports.sweepEscalationCopyForLocale("he", 4);
      const enCopy = workerTestExports.sweepEscalationCopyForLocale("en", 4);
      expect(heCopy.title).not.toBe(enCopy.title); // sanity: the two locales actually differ

      expect(sendPushToUser).toHaveBeenCalledWith(
        ctx.clinicId,
        heManagerId,
        expect.objectContaining({ title: heCopy.title, body: heCopy.body }),
      );
      expect(sendPushToUser).toHaveBeenCalledWith(
        ctx.clinicId,
        enManagerId,
        expect.objectContaining({ title: enCopy.title, body: enCopy.body }),
      );
    });

    it("no managers on record -> stage still advances to 4 (row/metric/audit), but no push fires", async () => {
      const pastEnd = localDateTime(2026, 2, 2, 18, 5);
      const result = await runSweepEscalation(pastEnd);
      expect(result.escalated).toBeGreaterThanOrEqual(1);

      const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
      expect(row?.escalation_stage).toBe(4);
      expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_4_fired");
      // No admin/vet seeded in this test's ctx -> zero manager recipients.
      expect(sendPushToUser).not.toHaveBeenCalledWith(ctx.clinicId, expect.anything(), expect.objectContaining({
        tag: `sweep-escalation:${ctx.clinicId}:${ctx.shiftDate}:4`,
      }));
    });
  });

  // ─── A2-7 (CodeRabbit PR #106) — sweep_missing counts as swept ────────────
  describe("A2-7: isShiftSweepComplete treats a sweep_missing anchor as a completed sweep for that room", () => {
    it("a room swept with ALL items missing (never-anchored, sweep_missing markers only) registers complete", async () => {
      const inWindow = localDateTime(2026, 2, 2, 9, 0);
      const now = localDateTime(2026, 2, 2, 17, 30);

      // Neither room has a source:"sweep" anchor — only sweep_missing markers
      // (A1-1's "never-anchored, unconfirmed" branch) for every homed item.
      await seedSweepMissingAnchor(randomUUID(), ctx.clinicId, ctx.itemAId, ctx.coordinatorId, inWindow);
      await seedSweepMissingAnchor(randomUUID(), ctx.clinicId, ctx.itemBId, ctx.coordinatorId, inWindow);

      await expect(isShiftSweepComplete(ctx.clinicId, { shiftStart: SHIFT_START_DT, now })).resolves.toBe(true);
    });

    it("without A2-7, a sweep_missing-only sweep would NOT register complete via a plain source:sweep check", async () => {
      // Documents the bug this fixes: zero source:"sweep" anchors exist for
      // either room in this scenario, so a query that only looked at
      // source:"sweep" would report the sweep incomplete forever.
      const now = localDateTime(2026, 2, 2, 17, 30);
      await expect(isShiftSweepComplete(ctx.clinicId, { shiftStart: SHIFT_START_DT, now })).resolves.toBe(false);
    });
  });

  // ─── A2-4/A2-5 (CodeRabbit PR #106) — worker startup wiring, mocked BullMQ ─
  //
  // `sweepQueueInitialized` is module-private state with no test reset hook,
  // so these two `it`s are deliberately ORDER-DEPENDENT (Vitest runs `it`s
  // within a describe sequentially, in declaration order, by default): the
  // A2-5 test's own retry assertion requires it to fail startup twice in a
  // row (each failure resets the guard), which leaves the guard `false`
  // afterward — exactly the precondition the A2-4 test needs to run at all.
  describe("A2-4/A2-5: startSweepEscalationWorker startup (mocked Redis/BullMQ)", () => {
    let createRedisConnection: (typeof import("../server/lib/redis.js"))["createRedisConnection"];
    let QueueMock: ReturnType<typeof vi.fn>;
    let WorkerMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      ({ createRedisConnection } = await import("../server/lib/redis.js"));
      const bullmq = (await import("bullmq")) as unknown as { Queue: ReturnType<typeof vi.fn>; Worker: ReturnType<typeof vi.fn> };
      QueueMock = bullmq.Queue;
      WorkerMock = bullmq.Worker;
    });

    afterEach(() => {
      vi.mocked(createRedisConnection).mockReset().mockResolvedValue(null);
      QueueMock.mockReset();
      WorkerMock.mockReset();
    });

    it("A2-5: a startup failure (queue.add rejects) is caught, closes partial connections, and resets init state so a later call retries", async () => {
      vi.mocked(createRedisConnection).mockResolvedValue({} as never);

      const queueClose = vi.fn().mockResolvedValue(undefined);
      const queueAdd = vi.fn().mockRejectedValue(new Error("redis add boom"));
      // `function`, not an arrow — the source calls `new Queue(...)`, and an
      // arrow-function mockImplementation cannot back a `new` invocation.
      QueueMock.mockImplementation(function () {
        return { add: queueAdd, close: queueClose };
      });

      const workerClose = vi.fn().mockResolvedValue(undefined);
      WorkerMock.mockImplementation(function () {
        return { on: vi.fn(), close: workerClose };
      });

      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      startSweepEscalationWorker();

      await vi.waitFor(() => {
        expect(queueClose).toHaveBeenCalled();
        expect(workerClose).toHaveBeenCalled();
      });
      expect(errSpy).toHaveBeenCalled();

      // Retry proof: a later call re-attempts createRedisConnection, which
      // only happens if the startup failure reset sweepQueueInitialized.
      const callsBefore = vi.mocked(createRedisConnection).mock.calls.length;
      startSweepEscalationWorker();
      await vi.waitFor(() => {
        expect(vi.mocked(createRedisConnection).mock.calls.length).toBeGreaterThan(callsBefore);
      });

      errSpy.mockRestore();
    });

    it("A2-4: the repeat job is added with the registry's attempts/backoff, not BullMQ's bare defaults", async () => {
      vi.mocked(createRedisConnection).mockResolvedValue({} as never);

      const queueAdd = vi.fn().mockResolvedValue(undefined);
      QueueMock.mockImplementation(function () {
        return { add: queueAdd, close: vi.fn().mockResolvedValue(undefined) };
      });
      WorkerMock.mockImplementation(function () {
        return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
      });

      startSweepEscalationWorker();

      await vi.waitFor(() => expect(queueAdd).toHaveBeenCalled());

      const [, , opts] = queueAdd.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect(opts.attempts).toBe(3);
      expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
      expect(opts.removeOnComplete).toBe(50);
      expect(opts.removeOnFail).toBe(100);
      expect(opts.jobId).toBeDefined();
      expect(opts.repeat).toBeDefined();
    });
  });
});
