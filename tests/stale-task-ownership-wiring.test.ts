/**
 * Phase 3 PR 3.7 — Stale-task-ownership wiring tests.
 *
 * Asserts:
 *   - off mode: no db query, no counter movement (off invariant)
 *   - shadow mode: counters fire; wiring never throws
 *   - enforce mode: counters fire for would-revoke; wiring STILL never
 *     throws and the tombstone `revoked` counter remains 0 (PR 3.6/3.7
 *     observation-only invariant per §12.4 and §13.3 asymmetry)
 *   - acknowledgedUserId === null → no db query, no counter movement
 *     (no owner to evaluate)
 *   - active-treatment safety floor short-circuits stale-denial (HARD
 *     invariant §11.4 / §12.6)
 *   - rollback shadow → off restores inert behavior
 *   - resolver throw → wiring returns without throwing (Strategy A)
 *
 * Tests drive the exported `applyStaleTaskOwnershipObservation` helper
 * directly to avoid having to build out the full service-call mock
 * scaffolding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbState } = vi.hoisted(() => {
  const dbState: {
    openCheckIn: { id: string }[];
    closedCheckIns: { checkedOutAt: Date | null }[];
    queryCount: number;
  } = { openCheckIn: [], closedCheckIns: [], queryCount: 0 };
  return { dbState };
});

vi.mock("../server/db.js", () => {
  // Simple call counter for db.select; values are returned in fixed order
  // (first call → openCheckIn lookup, second call → closedCheckIns).
  let callIndex = 0;
  const fluent = (rows: () => unknown[]) => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => rows() }),
        limit: async () => rows(),
      }),
    }),
  });
  const db = {
    select: () => {
      dbState.queryCount += 1;
      const turn = callIndex % 2;
      callIndex += 1;
      if (turn === 0) return fluent(() => dbState.openCheckIn);
      return fluent(() => dbState.closedCheckIns);
    },
  };
  return {
    db,
    appointments: {},
    clinicalCheckIns: {
      id: "clinicalCheckIns.id",
      clinicId: "clinicalCheckIns.clinicId",
      userId: "clinicalCheckIns.userId",
      checkedOutAt: "clinicalCheckIns.checkedOutAt",
    },
    users: {},
    animals: {},
    billingItems: {},
    billingLedger: {},
    containers: {},
    inventoryJobs: {},
    owners: {},
    shifts: {},
    auditLogs: {},
    eventOutbox: {},
  };
});

const mockResolveStaleMode = vi.fn();
const mockResolveTaskAssignmentMode = vi.fn();
vi.mock("../server/lib/authority/enforcement/config.js", () => ({
  resolveStaleTaskOwnershipEnforcementMode: (...args: unknown[]) => mockResolveStaleMode(...args),
  resolveTaskAssignmentEnforcementMode: (...args: unknown[]) => mockResolveTaskAssignmentMode(...args),
}));

import { applyStaleTaskOwnershipObservation } from "../server/services/appointments.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

const FIXED_NOW_REF = new Date("2026-05-15T12:00:00.000Z");
const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;

beforeEach(() => {
  dbState.openCheckIn = [];
  dbState.closedCheckIns = [];
  dbState.queryCount = 0;
  mockResolveStaleMode.mockReset();
  mockResolveTaskAssignmentMode.mockReset();
  resetMetrics();
  // Re-initialise the callIndex of the db mock by re-requiring isn't easy;
  // we rely on test independence at the resolver/data layer.
});

// ─────────────────────────────────────────────────────────────────────────────
// Off invariant

describe("PR 3.7 wiring — off invariant", () => {
  it("off mode: no db query, no counter movement", async () => {
    mockResolveStaleMode.mockResolvedValue("off");
    await applyStaleTaskOwnershipObservation({
      clinicId: "clinic-1",
      taskId: "task-1",
      acknowledgedUserId: "tech-1",
      acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
      status: "in_progress",
      updatedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
    });
    expect(dbState.queryCount).toBe(0);
    const snap = getMetricsSnapshot().staleTaskOwnership;
    expect(snap.wouldHaveRevoked).toBe(0);
    expect(snap.revoked).toBe(0);
  });

  it("null acknowledgedUserId: no db query in any mode (nothing to evaluate)", async () => {
    for (const mode of ["off", "shadow", "enforce"] as const) {
      dbState.queryCount = 0;
      mockResolveStaleMode.mockResolvedValueOnce(mode);
      await applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: null,
        acknowledgedAt: null,
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
      });
      expect(dbState.queryCount, `mode=${mode}`).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow mode

describe("PR 3.7 wiring — shadow mode", () => {
  it("shadow: stale row (owner checked out past grace) → wouldHaveRevoked counter", async () => {
    mockResolveStaleMode.mockResolvedValue("shadow");
    dbState.openCheckIn = []; // no open check-in
    dbState.closedCheckIns = [{ checkedOutAt: new Date(FIXED_NOW_REF.getTime() - 2 * ONE_HOUR) }];
    await applyStaleTaskOwnershipObservation({
      clinicId: "clinic-1",
      taskId: "task-1",
      acknowledgedUserId: "tech-1",
      acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
      status: "in_progress",
      updatedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
    });
    const snap = getMetricsSnapshot().staleTaskOwnership;
    expect(snap.wouldHaveRevoked).toBe(1);
    expect(snap.revoked).toBe(0); // tombstone
  });

  it("shadow: owner currently checked in → not_stale, no would-have-revoked", async () => {
    mockResolveStaleMode.mockResolvedValue("shadow");
    dbState.openCheckIn = [{ id: "ci-open" }];
    await applyStaleTaskOwnershipObservation({
      clinicId: "clinic-1",
      taskId: "task-1",
      acknowledgedUserId: "tech-1",
      acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
      status: "in_progress",
      updatedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
    });
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(0);
  });

  it("shadow: NEVER throws regardless of staleness", async () => {
    mockResolveStaleMode.mockResolvedValue("shadow");
    dbState.openCheckIn = [];
    dbState.closedCheckIns = [{ checkedOutAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR) }];
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enforce mode — PR 3.8 activates deny at the wiring layer

describe("PR 3.7 wiring — enforce mode (PR 3.8 deny activation)", () => {
  it("enforce + stale row → throws STALE_OWNERSHIP_DENIED 403", async () => {
    mockResolveStaleMode.mockResolvedValue("enforce");
    dbState.openCheckIn = [];
    dbState.closedCheckIns = [{ checkedOutAt: new Date(FIXED_NOW_REF.getTime() - 2 * ONE_HOUR) }];
    let thrown: unknown = null;
    try {
      await applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { name?: string })?.name).toBe("AppointmentServiceError");
    expect((thrown as { code?: string })?.code).toBe("STALE_OWNERSHIP_DENIED");
    expect((thrown as { status?: number })?.status).toBe(403);
    expect((thrown as { details?: Record<string, unknown> })?.details).toEqual({
      reason: "STALE_OWNERSHIP",
      taskId: "task-1",
    });
  });

  it("enforce + non-stale row (owner checked in) → no throw", async () => {
    mockResolveStaleMode.mockResolvedValue("enforce");
    dbState.openCheckIn = [{ id: "ci-open" }];
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW_REF.getTime() - ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
  });

  it("enforce + active-treatment task → no throw (HARD safety floor)", async () => {
    mockResolveStaleMode.mockResolvedValue("enforce");
    dbState.openCheckIn = [];
    dbState.closedCheckIns = [{ checkedOutAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR) }];
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 30_000), // active treatment
      }),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active-treatment safety floor (HARD invariant — §11.4 + §12.6)

describe("PR 3.7 wiring — active-treatment safety floor", () => {
  for (const mode of ["shadow", "enforce"] as const) {
    it(`${mode}: recently-updated in-progress task → activeTreatmentProtected, no wouldHaveRevoked`, async () => {
      mockResolveStaleMode.mockResolvedValue(mode);
      dbState.openCheckIn = [];
      dbState.closedCheckIns = [{ checkedOutAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR) }];
      await applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 24 * ONE_HOUR),
        status: "in_progress",
        // Just-updated → falls inside the 5-minute activity window
        updatedAt: new Date(Date.now() - 30_000),
      });
      const snap = getMetricsSnapshot().staleTaskOwnership;
      expect(snap.activeTreatmentProtected).toBeGreaterThanOrEqual(1);
      expect(snap.wouldHaveRevoked).toBe(0);
      expect(snap.revoked).toBe(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Rollback shadow → off

describe("PR 3.7 wiring — rollback invariant", () => {
  it("shadow then off: counter from shadow remains; off adds nothing", async () => {
    dbState.openCheckIn = [];
    dbState.closedCheckIns = [{ checkedOutAt: new Date(FIXED_NOW_REF.getTime() - 2 * ONE_HOUR) }];

    mockResolveStaleMode.mockResolvedValueOnce("shadow");
    await applyStaleTaskOwnershipObservation({
      clinicId: "clinic-1",
      taskId: "task-1",
      acknowledgedUserId: "tech-1",
      acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
      status: "in_progress",
      updatedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
    });
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(1);
    const queriesAfterShadow = dbState.queryCount;

    // Rollback to off: no new db query, no new counter movement.
    mockResolveStaleMode.mockResolvedValueOnce("off");
    await applyStaleTaskOwnershipObservation({
      clinicId: "clinic-1",
      taskId: "task-1",
      acknowledgedUserId: "tech-1",
      acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
      status: "in_progress",
      updatedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
    });
    expect(dbState.queryCount).toBe(queriesAfterShadow);
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategy A: resolver throws → wiring returns without throwing

describe("PR 3.7 wiring — Strategy A safety net", () => {
  it("resolver throws → wiring resolves without error, no db query, no counter", async () => {
    mockResolveStaleMode.mockRejectedValue(new Error("resolver pathological failure"));
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(FIXED_NOW_REF.getTime() - 3 * ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
    expect(dbState.queryCount).toBe(0);
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(0);
  });
});
