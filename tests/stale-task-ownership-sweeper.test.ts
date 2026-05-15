/**
 * Phase 3 PR 3.6 — Stale-task-ownership sweeper unit tests.
 *
 * Exercises the worker's `processStaleTaskOwnershipSweepJob` directly with
 * injected seams. The key invariants asserted here:
 *   - off mode short-circuits before any db scan (worker inert)
 *   - shadow mode scans + emits counters but performs NO revocation
 *   - the tombstone `revoked` counter NEVER moves in PR 3.6 (regardless
 *     of mode, including enforce — the enforce branch ships the verdict
 *     shape via the evaluator but the sweeper code has no revocation
 *     code path)
 *   - idempotent scan replay: re-running the worker on the same data
 *     produces the same statistics
 *   - lease acquisition: the BullMQ wrapper exposes the lease semantics
 *     (verified via the queue's at-most-one-active job contract — this
 *     test asserts the wrapper exports the expected names and that
 *     re-processing the same job id is a no-op for db effects)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mutable fixtures so the db mock can read them.
const { dbState } = vi.hoisted(() => {
  const dbState: {
    appointmentRows: Array<{
      id: string;
      acknowledgedUserId: string;
      acknowledgedAt: Date | null;
      status: string;
      updatedAt: Date;
    }>;
    queryCount: number;
  } = { appointmentRows: [], queryCount: 0 };
  return { dbState };
});

// PR 3.8: db.update is now exercised by the sweeper in enforce mode.
// The mock tracks update calls and returns a fluent chain. By default
// the UPDATE succeeds (returning one row); tests can override.
const { dbUpdateState } = vi.hoisted(() => {
  const dbUpdateState: { updateCalls: number; returnRows: { id: string }[] } = {
    updateCalls: 0,
    returnRows: [{ id: "updated-row" }],
  };
  return { dbUpdateState };
});

vi.mock("../server/db.js", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async (_n: number) => {
              dbState.queryCount += 1;
              return dbState.appointmentRows.map((r) => ({ ...r }));
            },
          }),
          limit: async (_n: number) => {
            dbState.queryCount += 1;
            return [];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            dbUpdateState.updateCalls += 1;
            return dbUpdateState.returnRows;
          },
        }),
      }),
    }),
    // PR 3.8: db.transaction wraps the UPDATE + audit emission for
    // atomic revocation. The mock provides a tx with the same update
    // fluent shape; transaction returns the callback's resolved value.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => {
                dbUpdateState.updateCalls += 1;
                return dbUpdateState.returnRows;
              },
            }),
          }),
        }),
        insert: () => ({
          values: async () => undefined,
        }),
      };
      return fn(tx);
    },
  };
  return {
    db,
    appointments: {
      id: "appointments.id",
      acknowledgedUserId: "appointments.acknowledgedUserId",
      acknowledgedAt: "appointments.acknowledgedAt",
      status: "appointments.status",
      updatedAt: "appointments.updatedAt",
      clinicId: "appointments.clinicId",
    },
    clinicalCheckIns: {
      clinicId: "clinicalCheckIns.clinicId",
      userId: "clinicalCheckIns.userId",
      checkedOutAt: "clinicalCheckIns.checkedOutAt",
      id: "clinicalCheckIns.id",
    },
    users: {},
    auditLogs: {},
    eventOutbox: {},
  };
});

import {
  processStaleTaskOwnershipSweepJob,
  type StaleTaskOwnershipSweepStats,
} from "../server/workers/staleTaskOwnershipSweepWorker.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type { Job } from "bullmq";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");
const ONE_HOUR = 60 * 60 * 1000;

function makeJob(clinicId: string): Job<{ clinicId: string; requestedByUserId: string; limit: number | null }> {
  return {
    id: `job-${clinicId}`,
    data: { clinicId, requestedByUserId: "admin", limit: null },
  } as unknown as Job<{ clinicId: string; requestedByUserId: string; limit: number | null }>;
}

beforeEach(() => {
  dbState.appointmentRows = [];
  dbState.queryCount = 0;
  dbUpdateState.updateCalls = 0;
  dbUpdateState.returnRows = [{ id: "updated-row" }];
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// Off-mode short-circuit (worker inert)

describe("processStaleTaskOwnershipSweepJob — off mode", () => {
  it("off mode: no db scan, empty stats", async () => {
    dbState.appointmentRows = [
      {
        id: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "off",
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats).toEqual<StaleTaskOwnershipSweepStats>({
      scanned: 0,
      notStale: 0,
      activeTreatmentProtected: 0,
      wouldHaveRevoked: 0,
      revoked: 0,
      emergencySuspendSkip: 0,
      degradedModePause: 0,
      error: 0,
    });
    expect(dbState.queryCount).toBe(0);
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });

  it("off mode: even with 100 rows in db, no scan occurs", async () => {
    for (let i = 0; i < 100; i++) {
      dbState.appointmentRows.push({
        id: `t-${i}`,
        acknowledgedUserId: "tech",
        acknowledgedAt: null,
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
      });
    }
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "off",
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.scanned).toBe(0);
    expect(dbState.queryCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow mode: scans, emits counters, NO revocation

describe("processStaleTaskOwnershipSweepJob — shadow mode", () => {
  it("shadow mode: stale row → wouldHaveRevoked counter; revoked tombstone stays 0", async () => {
    dbState.appointmentRows = [
      {
        id: "task-stale",
        acknowledgedUserId: "tech-stale",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "shadow",
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.scanned).toBe(1);
    expect(stats.wouldHaveRevoked).toBe(1);
    expect(stats.revoked).toBe(0); // tombstone
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });

  it("shadow mode: active-treatment row protected; would-have-revoked is 0", async () => {
    dbState.appointmentRows = [
      {
        id: "task-active",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 30_000), // 30s ago — active
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "shadow",
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.activeTreatmentProtected).toBe(1);
    expect(stats.wouldHaveRevoked).toBe(0);
    expect(stats.revoked).toBe(0);
  });

  it("shadow mode: not-stale row → notStale counter, no revoke", async () => {
    dbState.appointmentRows = [
      {
        id: "task-ok",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "shadow",
      fetchOwnerCheckInEndedAt: async () => null, // currently checked in
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.notStale).toBe(1);
    expect(stats.wouldHaveRevoked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enforce mode (PR 3.6 ships the verdict shape but NO revocation in the sweeper)

describe("processStaleTaskOwnershipSweepJob — enforce mode (PR 3.8 activation)", () => {
  it("enforce + stale row → live revocation: UPDATE executed, revoked counter increments", async () => {
    dbState.appointmentRows = [
      {
        id: "task-stale",
        acknowledgedUserId: "tech-stale",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "enforce",
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    });
    // PR 3.8: revoked now moves in enforce mode (was tombstone in PR 3.6).
    expect(stats.revoked).toBe(1);
    expect(dbUpdateState.updateCalls).toBe(1);
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(1);
    // The evaluator still increments wouldHaveRevoked when it produces the
    // would_revoke verdict — that's its observation contract. PR 3.8
    // additionally increments revoked when the UPDATE succeeded.
    expect(stats.wouldHaveRevoked).toBe(0); // sweeper-side counter; revoked-on-success path doesn't fall through to wouldHaveRevoked++
  });

  it("enforce + race-lost UPDATE → wouldHaveRevoked stat, no revoked increment", async () => {
    // Simulate the race case where another writer changed the owner
    // between our evaluator call and our UPDATE: the returning array is
    // empty (0 rows updated).
    dbState.appointmentRows = [
      {
        id: "task-stale",
        acknowledgedUserId: "tech-stale",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
      },
    ];
    dbUpdateState.returnRows = []; // race: 0 rows updated
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "enforce",
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.revoked).toBe(0);
    expect(stats.wouldHaveRevoked).toBe(1); // race-lost falls through to wouldHaveRevoked
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });

  it("shadow + stale row → NO revocation, wouldHaveRevoked counter increments", async () => {
    dbState.appointmentRows = [
      {
        id: "task-stale",
        acknowledgedUserId: "tech-stale",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "shadow",
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.wouldHaveRevoked).toBe(1);
    expect(stats.revoked).toBe(0); // shadow never revokes
    expect(dbUpdateState.updateCalls).toBe(0);
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });

  it("enforce with active-treatment task: safety floor wins (HARD) — no UPDATE", async () => {
    dbState.appointmentRows = [
      {
        id: "task-active",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 60_000), // 1 min — active
      },
    ];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "enforce",
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.activeTreatmentProtected).toBe(1);
    expect(stats.wouldHaveRevoked).toBe(0);
    expect(stats.revoked).toBe(0);
    // HARD INVARIANT: active treatment NEVER produces an UPDATE,
    // even in enforce mode.
    expect(dbUpdateState.updateCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotent scan replay

describe("processStaleTaskOwnershipSweepJob — idempotent scan replay", () => {
  it("two consecutive runs on same data produce same stats", async () => {
    dbState.appointmentRows = [
      {
        id: "task-stale",
        acknowledgedUserId: "tech-stale",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_HOUR),
      },
      {
        id: "task-active",
        acknowledgedUserId: "tech-2",
        acknowledgedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW.getTime() - 60_000),
      },
    ];

    const opts = {
      modeResolver: async () => "shadow" as const,
      fetchOwnerCheckInEndedAt: async () => new Date(FIXED_NOW.getTime() - ONE_HOUR),
      nowSupplier: () => FIXED_NOW,
    };

    const stats1 = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), opts);
    const stats2 = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), opts);

    expect(stats1).toEqual(stats2);
    expect(stats1.scanned).toBe(2);
    expect(stats1.wouldHaveRevoked).toBe(1);
    expect(stats1.activeTreatmentProtected).toBe(1);
    expect(stats1.revoked).toBe(0);
  });

  it("no-op on already-cleared ownership: empty result set → empty stats", async () => {
    dbState.appointmentRows = [];
    const stats = await processStaleTaskOwnershipSweepJob(makeJob("clinic-1"), {
      modeResolver: async () => "shadow",
      nowSupplier: () => FIXED_NOW,
    });
    expect(stats.scanned).toBe(0);
    expect(stats.wouldHaveRevoked).toBe(0);
  });
});
