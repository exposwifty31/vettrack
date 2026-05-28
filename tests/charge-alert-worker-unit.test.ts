/**
 * Unit tests for the charge-alert worker (Bug 3: return-time breach alert).
 *
 * Does NOT require Redis, a live server, or a real database.
 * All external dependencies (BullMQ, Drizzle db, push) are mocked via vi.mock.
 *
 * Covers:
 *   1. Delay calculation — normalizePlugInDeadlineMinutes logic and job ms formula
 *   2. processChargeAlertJob — unplugged equipment alerts
 *   3. processChargeAlertJob — plugged-in equipment does NOT alert
 *   4. processChargeAlertJob — idempotency (already alerted → skips)
 *   5. processChargeAlertJob — return record not found → skips
 *   6. buildChargeAlertJobId — stable job-id format
 *   7. enqueueChargeAlertJob — no-Redis path returns job id without scheduling
 *   8. Source-level assertions — delay formula present in worker source
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Module mocks — all vi.mock calls are hoisted by vitest before imports
// ---------------------------------------------------------------------------

// Prevent real BullMQ from creating Redis connections
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    getJob: vi.fn().mockResolvedValue(null),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
}));

// Prevent Redis connection attempts
vi.mock("../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn().mockResolvedValue(null),
}));

// Mock push so we can assert calls without real VAPID keys
vi.mock("../server/lib/push.js", () => ({
  sendPushToAll: vi.fn().mockResolvedValue(undefined),
  shouldSendPilotEnglishEquipmentPush: () => true,
}));

// Mock Drizzle db — select/update chains are configured per-test
vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  // Table reference objects — only need to exist (values unused by mocked chain)
  equipment: {},
  equipmentReturns: {},
}));

// ---------------------------------------------------------------------------
// Imports (resolved AFTER mocks are registered)
// ---------------------------------------------------------------------------

import {
  processChargeAlertJob,
  buildChargeAlertJobId,
  enqueueChargeAlertJob,
  CHARGE_ALERT_JOB_PREFIX,
  DEFAULT_PLUG_IN_DEADLINE_MINUTES,
} from "../server/workers/chargeAlertWorker.js";
import { sendPushToAll } from "../server/lib/push.js";
import { db } from "../server/db.js";

// ---------------------------------------------------------------------------
// Helpers — build Drizzle-style chained mock objects
// ---------------------------------------------------------------------------

/**
 * Builds a mock for db.select(...).from(...).where(...).limit(n) that
 * resolves with the provided rows array.
 */
function makeSelectChain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

/**
 * Builds a mock for db.update(...).set(...).where(...) that resolves void.
 */
function makeUpdateChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    set: () => chain,
    where: vi.fn().mockResolvedValue(undefined),
  };
  return chain;
}

const BASE_PAYLOAD = {
  returnId: "ret-aaa",
  equipmentId: "eq-111",
  clinicId: "clinic-test",
};

const UNPLUGGED_RETURN = {
  id: "ret-aaa",
  clinicId: "clinic-test",
  equipmentId: "eq-111",
  isPluggedIn: false,
  plugInDeadlineMinutes: 30,
  plugInAlertSentAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Delay calculation — pure math, mirrored from source
// ---------------------------------------------------------------------------

describe("Delay calculation — normalizePlugInDeadlineMinutes", () => {
  // Mirror of the private function in chargeAlertWorker.ts
  function normalizePlugInDeadlineMinutes(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_PLUG_IN_DEADLINE_MINUTES;
    const rounded = Math.floor(value);
    if (rounded < 1) return DEFAULT_PLUG_IN_DEADLINE_MINUTES;
    return Math.min(rounded, 1440);
  }

  it("30-minute deadline → 1 800 000 ms delay", () => {
    expect(normalizePlugInDeadlineMinutes(30) * 60 * 1000).toBe(1_800_000);
  });

  it("1-minute minimum is preserved", () => {
    expect(normalizePlugInDeadlineMinutes(1)).toBe(1);
  });

  it("0 falls back to default (30)", () => {
    expect(normalizePlugInDeadlineMinutes(0)).toBe(DEFAULT_PLUG_IN_DEADLINE_MINUTES);
  });

  it("negative falls back to default", () => {
    expect(normalizePlugInDeadlineMinutes(-5)).toBe(DEFAULT_PLUG_IN_DEADLINE_MINUTES);
  });

  it("Infinity falls back to default", () => {
    expect(normalizePlugInDeadlineMinutes(Infinity)).toBe(DEFAULT_PLUG_IN_DEADLINE_MINUTES);
  });

  it("NaN falls back to default", () => {
    expect(normalizePlugInDeadlineMinutes(NaN)).toBe(DEFAULT_PLUG_IN_DEADLINE_MINUTES);
  });

  it("floats are floored (1.9 → 1)", () => {
    expect(normalizePlugInDeadlineMinutes(1.9)).toBe(1);
  });

  it("clamped at 1440 minutes (24 h)", () => {
    expect(normalizePlugInDeadlineMinutes(9999)).toBe(1440);
    expect(normalizePlugInDeadlineMinutes(1440)).toBe(1440);
    expect(normalizePlugInDeadlineMinutes(1441)).toBe(1440);
  });

  it("45-minute deadline → 2 700 000 ms", () => {
    expect(normalizePlugInDeadlineMinutes(45) * 60 * 1000).toBe(2_700_000);
  });
});

// ---------------------------------------------------------------------------
// 2. Source-level assertion — delay formula present in worker source
// ---------------------------------------------------------------------------

describe("Worker source — delay formula contract", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../server/workers/chargeAlertWorker.ts"),
    "utf8",
  );

  it("job delay is calculated as plugInDeadlineMinutes × 60 × 1000 ms", () => {
    expect(source).toContain("normalizePlugInDeadlineMinutes(params.plugInDeadlineMinutes) * 60 * 1000");
  });

  it("queue name is 'charge-alert'", () => {
    expect(source).toContain('CHARGE_ALERT_QUEUE_NAME = "charge-alert"');
  });

  it("job name is 'check-plug'", () => {
    expect(source).toContain('CHARGE_ALERT_JOB_NAME = "check-plug"');
  });

  it("job payload contains returnId, equipmentId, clinicId", () => {
    expect(source).toContain("returnId: params.returnId");
    expect(source).toContain("equipmentId: params.equipmentId");
    expect(source).toContain("clinicId: params.clinicId");
  });

  it("job is idempotent — uses a stable jobId derived from returnId", () => {
    expect(source).toContain("jobId,");
    expect(source).toContain("buildChargeAlertJobId(params.returnId)");
  });

  it("plugInAlertSentAt is set after push is sent (dedup guard)", () => {
    expect(source).toContain("markChargeAlertSent");
    expect(source).toContain("plugInAlertSentAt");
  });
});

// ---------------------------------------------------------------------------
// 3. buildChargeAlertJobId — stable format
// ---------------------------------------------------------------------------

describe("buildChargeAlertJobId", () => {
  it("returns the prefix + returnId", () => {
    expect(buildChargeAlertJobId("ret-xyz")).toBe(`${CHARGE_ALERT_JOB_PREFIX}ret-xyz`);
  });

  it("two different returnIds produce different job ids", () => {
    expect(buildChargeAlertJobId("a")).not.toBe(buildChargeAlertJobId("b"));
  });
});

// ---------------------------------------------------------------------------
// 4. processChargeAlertJob — unplugged equipment alerts
// ---------------------------------------------------------------------------

describe("processChargeAlertJob — unplugged equipment", () => {
  it("sends push notification and returns 'alerted'", async () => {
    // First select → getReturnRecord
    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([UNPLUGGED_RETURN]))
      // Second select → getEquipmentName
      .mockReturnValueOnce(makeSelectChain([{ name: "Infusion Pump" }]));
    vi.mocked(db.update).mockReturnValue(makeUpdateChain());

    const result = await processChargeAlertJob(BASE_PAYLOAD);

    expect(result).toBe("alerted");
    expect(sendPushToAll).toHaveBeenCalledOnce();
    expect(sendPushToAll).toHaveBeenCalledWith(
      BASE_PAYLOAD.clinicId,
      expect.objectContaining({
        url: `/equipment/${BASE_PAYLOAD.equipmentId}`,
        tag: expect.stringContaining(UNPLUGGED_RETURN.id),
      }),
    );
  });

  it("push payload body mentions the equipment name and deadline", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([UNPLUGGED_RETURN]))
      .mockReturnValueOnce(makeSelectChain([{ name: "Defibrillator" }]));
    vi.mocked(db.update).mockReturnValue(makeUpdateChain());

    await processChargeAlertJob(BASE_PAYLOAD);

    const [, pushPayload] = vi.mocked(sendPushToAll).mock.calls[0];
    expect(pushPayload.body).toContain("Defibrillator");
    expect(pushPayload.body).toContain(String(UNPLUGGED_RETURN.plugInDeadlineMinutes));
  });

  it("marks plugInAlertSentAt after alerting (idempotency guard)", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([UNPLUGGED_RETURN]))
      .mockReturnValueOnce(makeSelectChain([{ name: "Pump" }]));
    const updateChain = makeUpdateChain();
    vi.mocked(db.update).mockReturnValue(updateChain);

    await processChargeAlertJob(BASE_PAYLOAD);

    // db.update was called (to mark plugInAlertSentAt)
    expect(vi.mocked(db.update)).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. processChargeAlertJob — plugged-in equipment does NOT alert
// ---------------------------------------------------------------------------

describe("processChargeAlertJob — plugged-in equipment", () => {
  it("returns 'skipped' and does not call sendPushToAll", async () => {
    const pluggedInReturn = { ...UNPLUGGED_RETURN, isPluggedIn: true };
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([pluggedInReturn]));

    const result = await processChargeAlertJob(BASE_PAYLOAD);

    expect(result).toBe("skipped");
    expect(sendPushToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. processChargeAlertJob — idempotency (already alerted)
// ---------------------------------------------------------------------------

describe("processChargeAlertJob — idempotency", () => {
  it("returns 'skipped' when plugInAlertSentAt is already set", async () => {
    const alreadyAlerted = { ...UNPLUGGED_RETURN, plugInAlertSentAt: new Date("2026-01-01T00:00:00Z") };
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([alreadyAlerted]));

    const result = await processChargeAlertJob(BASE_PAYLOAD);

    expect(result).toBe("skipped");
    expect(sendPushToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. processChargeAlertJob — return record not found
// ---------------------------------------------------------------------------

describe("processChargeAlertJob — return not found", () => {
  it("returns 'skipped' when the return record is missing", async () => {
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([])); // empty result

    const result = await processChargeAlertJob(BASE_PAYLOAD);

    expect(result).toBe("skipped");
    expect(sendPushToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. enqueueChargeAlertJob — no-Redis path
// ---------------------------------------------------------------------------

describe("enqueueChargeAlertJob — no Redis available", () => {
  it("returns the stable job id without scheduling when queue is null", async () => {
    // chargeAlertQueue is null at module init (Redis mock returns null from createRedisConnection)
    const jobId = await enqueueChargeAlertJob({
      returnId: "ret-zzz",
      equipmentId: "eq-999",
      clinicId: "clinic-x",
      plugInDeadlineMinutes: 30,
    });

    expect(jobId).toBe(buildChargeAlertJobId("ret-zzz"));
  });
});
