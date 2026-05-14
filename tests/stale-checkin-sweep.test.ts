/**
 * Unit tests for the stale check-in sweeper (Phase 2.5 PR 5.2 — Shadow-only).
 *
 * Does NOT require Redis, a live server, or a real database.
 * All external dependencies (BullMQ, Drizzle db, redis) are mocked via vi.mock.
 *
 * Verifies:
 *   1. Bucket classification — fresh / soft_stale / stale / hard_stale boundaries
 *   2. Per-clinic aggregation — distinct entries, oldestCheckInAgeHours
 *   3. Sample cap — at most 20 IDs in the summary log; oldest first; 8-char prefix
 *   4. Dedupe limiter — second invocation does not re-emit the per-clinic warn
 *   5. Recurring stale set — intersection across runs increments counter
 *   6. Disabled flag (default false) — worker registers nothing
 *   7. Redis unavailable — warn log, no queue registration
 *   8. Enabled + Redis available — queue + worker + repeat job registered
 *   9. No-mutation contract — db.update/insert/delete never called
 *  10. Source-level contract — worker source contains no mutation verbs and
 *      no calls to closeCheckIn / autoCheckOutForSessionEnd
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Module mocks — vi.mock calls are hoisted by vitest before imports
// ---------------------------------------------------------------------------

vi.mock("bullmq", () => {
  // BullMQ's Queue/Worker are invoked with `new`. Vitest 4 requires the
  // implementation to use a `function` (not arrow) for constructor calls.
  const Queue = vi.fn();
  Queue.mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn().mockResolvedValue({});
  });
  const Worker = vi.fn();
  Worker.mockImplementation(function (this: { on: ReturnType<typeof vi.fn> }) {
    this.on = vi.fn();
  });
  return { Queue, Worker };
});

vi.mock("../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn().mockResolvedValue(null),
}));

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  clinicalCheckIns: {
    id: "id",
    clinicId: "clinic_id",
    checkedInAt: "checked_in_at",
    checkedOutAt: "checked_out_at",
  },
}));

import { Queue, Worker } from "bullmq";
import {
  runStaleCheckInSweep,
  startStaleCheckInSweepWorker,
  classifyBucket,
  __resetSweepStateForTests,
  __test,
} from "../server/workers/staleCheckInSweepWorker.js";
import { db } from "../server/db.js";
import { createRedisConnection } from "../server/lib/redis.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSelectChain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

const NOW = new Date("2026-05-14T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  __resetSweepStateForTests();
  delete process.env.STALE_CHECKIN_SWEEP_ENABLED;
});

afterEach(() => {
  delete process.env.STALE_CHECKIN_SWEEP_ENABLED;
});

// ---------------------------------------------------------------------------
// 1. Bucket classification — boundary correctness
// ---------------------------------------------------------------------------

describe("classifyBucket — boundary correctness", () => {
  it("ageHrs < 24 → fresh", () => {
    expect(classifyBucket(0)).toBe("fresh");
    expect(classifyBucket(10)).toBe("fresh");
    expect(classifyBucket(23.99)).toBe("fresh");
  });

  it("24 ≤ ageHrs < 36 → soft_stale", () => {
    expect(classifyBucket(24)).toBe("soft_stale");
    expect(classifyBucket(30)).toBe("soft_stale");
    expect(classifyBucket(35.99)).toBe("soft_stale");
  });

  it("36 ≤ ageHrs < 72 → stale", () => {
    expect(classifyBucket(36)).toBe("stale");
    expect(classifyBucket(50)).toBe("stale");
    expect(classifyBucket(71.99)).toBe("stale");
  });

  it("ageHrs ≥ 72 → hard_stale", () => {
    expect(classifyBucket(72)).toBe("hard_stale");
    expect(classifyBucket(120)).toBe("hard_stale");
    expect(classifyBucket(99999)).toBe("hard_stale");
  });

  it("exported thresholds match expected values", () => {
    expect(__test.FRESH_THRESHOLD_HOURS).toBe(24);
    expect(__test.STALE_THRESHOLD_HOURS).toBe(36);
    expect(__test.HARD_STALE_THRESHOLD_HOURS).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// 2. Per-clinic aggregation — distinct rows, distinct counts
// ---------------------------------------------------------------------------

describe("runStaleCheckInSweep — per-clinic aggregation", () => {
  it("groups rows by clinicId and computes per-bucket counts", async () => {
    const rows = [
      { id: "c1-a", clinicId: "clinic-1", checkedInAt: hoursAgo(NOW, 10) }, // fresh
      { id: "c1-b", clinicId: "clinic-1", checkedInAt: hoursAgo(NOW, 25) }, // soft
      { id: "c1-c", clinicId: "clinic-1", checkedInAt: hoursAgo(NOW, 40) }, // stale
      { id: "c2-a", clinicId: "clinic-2", checkedInAt: hoursAgo(NOW, 80) }, // hard_stale
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));

    const result = await runStaleCheckInSweep(NOW);

    expect(result.clinicsScanned).toBe(2);
    expect(result.totalOpen).toBe(4);
    expect(result.totalFresh).toBe(1);
    expect(result.totalSoftStale).toBe(1);
    expect(result.totalStale).toBe(1);
    expect(result.totalHardStale).toBe(1);

    const c1 = result.perClinic.find((c) => c.clinicId === "clinic-1");
    const c2 = result.perClinic.find((c) => c.clinicId === "clinic-2");
    expect(c1).toMatchObject({ totalOpen: 3, fresh: 1, softStale: 1, stale: 1, hardStale: 0 });
    expect(c2).toMatchObject({ totalOpen: 1, fresh: 0, softStale: 0, stale: 0, hardStale: 1 });
    expect(c1!.oldestCheckInAgeHours).toBeGreaterThanOrEqual(40);
    expect(c2!.oldestCheckInAgeHours).toBeGreaterThanOrEqual(80);
  });

  it("returns zero counters when there are no open rows", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]));
    const result = await runStaleCheckInSweep(NOW);
    expect(result).toMatchObject({
      totalOpen: 0,
      totalFresh: 0,
      totalSoftStale: 0,
      totalStale: 0,
      totalHardStale: 0,
      clinicsScanned: 0,
      recurringStaleCount: 0,
      sampledStaleIds: [],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Sample cap — 20 IDs max, oldest first, 8-char prefix
// ---------------------------------------------------------------------------

describe("runStaleCheckInSweep — sample cap", () => {
  it("caps sampledStaleIds at 20 even when 50 stale rows exist", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `stale-id-${String(i).padStart(4, "0")}-tail`,
      clinicId: "clinic-1",
      checkedInAt: hoursAgo(NOW, 40 + i), // all stale; increasing age
    }));
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));

    const result = await runStaleCheckInSweep(NOW);

    expect(result.totalStale + result.totalHardStale).toBe(50);
    expect(result.sampledStaleIds).toHaveLength(20);
    // Oldest first: the last seeded row (i=49) has highest age and should
    // appear first in the sample.
    expect(result.sampledStaleIds[0]).toBe("stale-id");
    // 8-char prefix only — full UUIDs are not logged.
    for (const sampled of result.sampledStaleIds) {
      expect(sampled.length).toBeLessThanOrEqual(8);
    }
  });

  it("sample is ordered oldest-first", async () => {
    // IDs are sliced to 8 chars in logs — pick IDs whose first 8 chars are
    // distinct and unambiguously ordered.
    const rows = [
      { id: "aaa-young-id", clinicId: "c", checkedInAt: hoursAgo(NOW, 37) },
      { id: "ccc-oldest-id", clinicId: "c", checkedInAt: hoursAgo(NOW, 80) },
      { id: "bbb-middle-id", clinicId: "c", checkedInAt: hoursAgo(NOW, 50) },
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));

    const result = await runStaleCheckInSweep(NOW);

    expect(result.sampledStaleIds).toEqual(["ccc-olde", "bbb-midd", "aaa-youn"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Dedupe limiter — per-clinic warn suppressed on rapid second run
// ---------------------------------------------------------------------------

describe("runStaleCheckInSweep — dedupe limiter", () => {
  it("does not re-emit the per-clinic warn on a second invocation within window", async () => {
    const rows = [
      { id: "c1-stale", clinicId: "clinic-1", checkedInAt: hoursAgo(NOW, 40) },
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runStaleCheckInSweep(NOW);
    const firstCalls = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("clinic has stale check-ins"),
    ).length;
    expect(firstCalls).toBe(1);

    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));
    await runStaleCheckInSweep(NOW);
    const secondCalls = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("clinic has stale check-ins"),
    ).length;
    expect(secondCalls).toBe(1); // suppressed — still only the first

    warnSpy.mockRestore();
  });

  it("does not warn for clinics with zero stale + hardStale rows", async () => {
    const rows = [
      { id: "c1-fresh", clinicId: "clinic-1", checkedInAt: hoursAgo(NOW, 10) },
      { id: "c1-soft", clinicId: "clinic-1", checkedInAt: hoursAgo(NOW, 25) },
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runStaleCheckInSweep(NOW);
    const clinicWarns = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("clinic has stale check-ins"),
    ).length;
    expect(clinicWarns).toBe(0);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. Recurring stale set — intersection across runs
// ---------------------------------------------------------------------------

describe("runStaleCheckInSweep — recurring stale detection", () => {
  it("counts IDs seen as stale in both consecutive runs", async () => {
    const rowsRun1 = [
      { id: "keeps-being-stale", clinicId: "c", checkedInAt: hoursAgo(NOW, 40) },
      { id: "one-time-stale", clinicId: "c", checkedInAt: hoursAgo(NOW, 45) },
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rowsRun1));
    const r1 = await runStaleCheckInSweep(NOW);
    expect(r1.recurringStaleCount).toBe(0); // nothing seen previously

    const rowsRun2 = [
      { id: "keeps-being-stale", clinicId: "c", checkedInAt: hoursAgo(NOW, 46) }, // still stale
      { id: "new-stale", clinicId: "c", checkedInAt: hoursAgo(NOW, 40) }, // new entrant
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rowsRun2));
    const r2 = await runStaleCheckInSweep(NOW);
    expect(r2.recurringStaleCount).toBe(1); // only "keeps-being-stale" was seen previously
  });

  it("resets recurring set after __resetSweepStateForTests", async () => {
    vi.mocked(db.select).mockReturnValue(
      makeSelectChain([
        { id: "x", clinicId: "c", checkedInAt: hoursAgo(NOW, 40) },
      ]),
    );
    await runStaleCheckInSweep(NOW);

    __resetSweepStateForTests();

    vi.mocked(db.select).mockReturnValue(
      makeSelectChain([
        { id: "x", clinicId: "c", checkedInAt: hoursAgo(NOW, 40) },
      ]),
    );
    const r = await runStaleCheckInSweep(NOW);
    expect(r.recurringStaleCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Disabled-by-default — flag must be explicitly enabled
// ---------------------------------------------------------------------------

describe("startStaleCheckInSweepWorker — disabled flag", () => {
  it("is disabled by default (env var unset) and registers nothing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await startStaleCheckInSweepWorker();

    expect(createRedisConnection).not.toHaveBeenCalled();
    expect(Queue).not.toHaveBeenCalled();
    expect(Worker).not.toHaveBeenCalled();
    const disabledLog = logSpy.mock.calls.find(
      ([msg]) =>
        typeof msg === "string" && msg.includes("disabled by STALE_CHECKIN_SWEEP_ENABLED flag"),
    );
    expect(disabledLog).toBeTruthy();

    logSpy.mockRestore();
  });

  it("is disabled when env var is explicitly 'false'", async () => {
    process.env.STALE_CHECKIN_SWEEP_ENABLED = "false";
    await startStaleCheckInSweepWorker();
    expect(createRedisConnection).not.toHaveBeenCalled();
    expect(Queue).not.toHaveBeenCalled();
  });

  it("is disabled when env var is any non-'true' value", async () => {
    process.env.STALE_CHECKIN_SWEEP_ENABLED = "1";
    await startStaleCheckInSweepWorker();
    expect(createRedisConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Redis unavailable — graceful warning, no registration
// ---------------------------------------------------------------------------

describe("startStaleCheckInSweepWorker — Redis unavailable", () => {
  it("logs warn and does not construct Queue/Worker when createRedisConnection returns null", async () => {
    process.env.STALE_CHECKIN_SWEEP_ENABLED = "true";
    vi.mocked(createRedisConnection).mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await startStaleCheckInSweepWorker();

    expect(Queue).not.toHaveBeenCalled();
    expect(Worker).not.toHaveBeenCalled();
    const disabledWarn = warnSpy.mock.calls.find(
      ([msg]) =>
        typeof msg === "string" && msg.includes("queue disabled (Redis unavailable)"),
    );
    expect(disabledWarn).toBeTruthy();

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 8. Enabled + Redis OK — queue + worker + repeat job registered
// ---------------------------------------------------------------------------

describe("startStaleCheckInSweepWorker — enabled with Redis", () => {
  it("registers queue, worker, and idempotent repeat job", async () => {
    process.env.STALE_CHECKIN_SWEEP_ENABLED = "true";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createRedisConnection).mockResolvedValue({} as any);

    await startStaleCheckInSweepWorker();

    expect(Queue).toHaveBeenCalledWith(
      __test.STALE_CHECKIN_SWEEP_QUEUE_NAME,
      expect.objectContaining({ connection: expect.anything() }),
    );
    expect(Worker).toHaveBeenCalledWith(
      __test.STALE_CHECKIN_SWEEP_QUEUE_NAME,
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );

    // The Queue's add() call should reference the repeat jobId + cron pattern.
    const queueInstance = vi.mocked(Queue).mock.instances[0] as unknown as {
      add: ReturnType<typeof vi.fn>;
    };
    expect(queueInstance.add).toHaveBeenCalledWith(
      __test.STALE_CHECKIN_SWEEP_JOB_NAME,
      {},
      expect.objectContaining({
        jobId: __test.STALE_CHECKIN_SWEEP_REPEAT_JOB_ID,
        repeat: { pattern: __test.STALE_CHECKIN_SWEEP_CRON },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. No-mutation contract — spies confirm no write methods invoked
// ---------------------------------------------------------------------------

describe("runStaleCheckInSweep — no-mutation contract", () => {
  it("never calls db.update, db.insert, or db.delete during a full sweep", async () => {
    const rows = [
      { id: "fresh-1", clinicId: "c1", checkedInAt: hoursAgo(NOW, 5) },
      { id: "soft-1", clinicId: "c1", checkedInAt: hoursAgo(NOW, 28) },
      { id: "stale-1", clinicId: "c2", checkedInAt: hoursAgo(NOW, 50) },
      { id: "hard-1", clinicId: "c2", checkedInAt: hoursAgo(NOW, 100) },
    ];
    vi.mocked(db.select).mockReturnValue(makeSelectChain(rows));

    await runStaleCheckInSweep(NOW);

    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. Source-level contract — no mutation verbs or close-call references
// ---------------------------------------------------------------------------

describe("Worker source — shadow-only contract", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../server/workers/staleCheckInSweepWorker.ts"),
    "utf8",
  );

  it("contains no db.update( call", () => {
    expect(source).not.toMatch(/\bdb\.update\(/);
  });

  it("contains no db.insert( call", () => {
    expect(source).not.toMatch(/\bdb\.insert\(/);
  });

  it("contains no db.delete( call", () => {
    expect(source).not.toMatch(/\bdb\.delete\(/);
  });

  it("contains no closeCheckIn reference", () => {
    expect(source).not.toMatch(/closeCheckIn/);
  });

  it("contains no autoCheckOutForSessionEnd reference", () => {
    expect(source).not.toMatch(/autoCheckOutForSessionEnd/);
  });

  it("queue name is 'stale-checkin-sweep'", () => {
    expect(source).toContain('STALE_CHECKIN_SWEEP_QUEUE_NAME = "stale-checkin-sweep"');
  });

  it("uses 6h-stepped cron pattern", () => {
    expect(source).toContain('STALE_CHECKIN_SWEEP_CRON = "17 */6 * * *"');
  });

  it("uses idempotent repeat jobId", () => {
    expect(source).toContain('STALE_CHECKIN_SWEEP_REPEAT_JOB_ID = "repeat-stale-checkin-sweep"');
  });

  it("worker is gated on STALE_CHECKIN_SWEEP_ENABLED env var", () => {
    expect(source).toContain('STALE_CHECKIN_SWEEP_ENABLED');
  });
});
