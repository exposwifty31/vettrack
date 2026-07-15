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

  it("60 minutes to end (boundary) -> stage 0", () => {
    expect(computeEscalationStage(60)).toBe(0);
  });

  it("50 minutes to end -> stage 1 (coordinator reminded)", () => {
    expect(computeEscalationStage(50)).toBe(1);
  });

  it("40 minutes to end (boundary) -> stage 1", () => {
    expect(computeEscalationStage(40)).toBe(1);
  });

  it("30 minutes to end -> stage 2 (senior notified)", () => {
    expect(computeEscalationStage(30)).toBe(2);
  });

  it("20 minutes to end (boundary) -> stage 2", () => {
    expect(computeEscalationStage(20)).toBe(2);
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

async function seedClinic(clinicId: string) {
  await probePool!.query(`INSERT INTO vt_clinics (id) VALUES ($1) ON CONFLICT DO NOTHING`, [clinicId]);
}

async function seedUser(
  userId: string,
  clinicId: string,
  opts: { name: string; role?: string; isEquipmentCoordinator?: boolean },
) {
  await probePool!.query(
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

    ({ runSweepEscalation } = await import("../server/workers/sweep-escalation.worker.js"));
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
    // 18:00 SHIFT_END + 5 minutes — one tick past end, still inside the
    // 10-minute SWEEP_INTERVAL_MS grace window, sweep still incomplete
    // (no anchors seeded for either homed room in this test's ctx).
    const pastEnd = localDateTime(2026, 2, 2, 18, 5);
    const result = await runSweepEscalation(pastEnd);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await getCoordinatorRow(ctx.clinicId, ctx.shiftDate);
    expect(row?.escalation_stage).toBe(4);
    expect(row?.current_responsible_user_id).toBeNull(); // stage 4 opens to all — no single responsible party

    expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "admin", expect.any(Object));
    expect(sendPushToRole).toHaveBeenCalledWith(ctx.clinicId, "vet", expect.any(Object));
    expect(incrementMetric).toHaveBeenCalledWith("sweep_escalation_stage_4_fired");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: ctx.clinicId,
        actionType: "room_sweep_escalated",
        metadata: expect.objectContaining({ stage: 4 }),
      }),
    );
  });

  it("I-1: a shift more than SWEEP_INTERVAL_MS past its end is out of the grace window — no longer a candidate", async () => {
    // 18:00 SHIFT_END + 15 minutes — outside the 10-minute grace window.
    const wayPastEnd = localDateTime(2026, 2, 2, 18, 15);
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
});
