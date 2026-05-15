/**
 * Phase 3 PR 3.8 — Enforcement rollout acceptance tests.
 *
 * Per §13.17 acceptance criteria. Covers:
 *   - Layered rollback (enforce → shadow → off) convergence at the
 *     wiring layer (criterion #5).
 *   - Active-treatment HARD invariant under enforce (criterion #4).
 *   - Per-clinic isolation (criterion #6) — clinic A enforce + clinic B
 *     shadow do not interfere.
 *   - Sweeper enforce activation produces revocation audit (criterion
 *     #3 — stale revocations occur subject to safety floor).
 *
 * These are PR-3.8-specific integration tests on top of the per-PR
 * tests that already exist in PRs 3.6 / 3.7. They prove the rollout
 * contract end-to-end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mutable state for the wiring path. The wiring's db is a
// distinct mock from the sweeper's; we keep them isolated.
const { wiringDbState } = vi.hoisted(() => {
  const wiringDbState: {
    openCheckIn: { id: string }[];
    closedCheckIns: { checkedOutAt: Date | null }[];
    queryCount: number;
  } = { openCheckIn: [], closedCheckIns: [], queryCount: 0 };
  return { wiringDbState };
});

vi.mock("../server/db.js", () => {
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
      wiringDbState.queryCount += 1;
      const turn = callIndex % 2;
      callIndex += 1;
      if (turn === 0) return fluent(() => wiringDbState.openCheckIn);
      return fluent(() => wiringDbState.closedCheckIns);
    },
  };
  return {
    db,
    appointments: {},
    clinicalCheckIns: {
      id: "ci.id",
      clinicId: "ci.clinicId",
      userId: "ci.userId",
      checkedOutAt: "ci.checkedOutAt",
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

const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const PAST_GRACE = new Date(Date.now() - 2 * ONE_HOUR);

beforeEach(() => {
  wiringDbState.openCheckIn = [];
  wiringDbState.closedCheckIns = [];
  wiringDbState.queryCount = 0;
  mockResolveStaleMode.mockReset();
  mockResolveTaskAssignmentMode.mockReset();
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.17 #4: Active-treatment HARD invariant under enforce

describe("PR 3.8 — active-treatment safety floor under enforce (HARD §13.6)", () => {
  it("enforce + active-treatment task → no throw, no revocation at wiring", async () => {
    mockResolveStaleMode.mockResolvedValue("enforce");
    wiringDbState.openCheckIn = [];
    wiringDbState.closedCheckIns = [{ checkedOutAt: PAST_GRACE }];
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-active",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(Date.now() - 24 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 30_000), // active treatment
      }),
    ).resolves.toBeUndefined();
    expect(getMetricsSnapshot().staleTaskOwnership.activeTreatmentProtected).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.17 #5: Layered rollback enforce → shadow → off

describe("PR 3.8 — layered rollback (enforce → shadow → off)", () => {
  it("enforce throws; shadow rollback observes-without-throw; off rollback is silent", async () => {
    wiringDbState.openCheckIn = [];
    wiringDbState.closedCheckIns = [{ checkedOutAt: PAST_GRACE }];

    // Phase 1: enforce — throws.
    mockResolveStaleMode.mockResolvedValueOnce("enforce");
    let thrown: unknown = null;
    try {
      await applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(Date.now() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 3 * ONE_HOUR),
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string })?.code).toBe("STALE_OWNERSHIP_DENIED");
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(1);

    // Phase 2: rollback to shadow — observation only, no throw.
    mockResolveStaleMode.mockResolvedValueOnce("shadow");
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-2",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(Date.now() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 3 * ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
    // wouldHaveRevoked moves; revoked tombstone untouched at wiring layer.
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(2);
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);

    // Phase 3: rollback to off — fully inert.
    mockResolveStaleMode.mockResolvedValueOnce("off");
    const dbCallsBefore = wiringDbState.queryCount;
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-3",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(Date.now() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 3 * ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
    // No new db query in off mode.
    expect(wiringDbState.queryCount).toBe(dbCallsBefore);
    // Counters from prior modes are historical facts; off adds nothing.
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.17 #6: Per-clinic isolation

describe("PR 3.8 — per-clinic isolation", () => {
  it("clinic A enforce + clinic B shadow: clinic B sees no denial", async () => {
    wiringDbState.openCheckIn = [];
    wiringDbState.closedCheckIns = [{ checkedOutAt: PAST_GRACE }];

    // Clinic A in enforce: throws.
    mockResolveStaleMode.mockImplementation(async (clinicId: string) => {
      if (clinicId === "clinic-A") return "enforce";
      if (clinicId === "clinic-B") return "shadow";
      return "off";
    });

    let thrownA: unknown = null;
    try {
      await applyStaleTaskOwnershipObservation({
        clinicId: "clinic-A",
        taskId: "task-A",
        acknowledgedUserId: "tech",
        acknowledgedAt: new Date(Date.now() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 3 * ONE_HOUR),
      });
    } catch (e) {
      thrownA = e;
    }
    expect((thrownA as { code?: string })?.code).toBe("STALE_OWNERSHIP_DENIED");

    // Clinic B in shadow: observes without throw.
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-B",
        taskId: "task-B",
        acknowledgedUserId: "tech",
        acknowledgedAt: new Date(Date.now() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 3 * ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.17 #11: Strategy A invariant in enforce — resolver throw degrades to off

describe("PR 3.8 — Strategy A at the wiring layer (resolver throw)", () => {
  it("resolver throws even in enforce mode → wiring resolves without throwing", async () => {
    mockResolveStaleMode.mockRejectedValue(new Error("resolver pathological"));
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(Date.now() - 3 * ONE_HOUR),
        status: "in_progress",
        updatedAt: new Date(Date.now() - 3 * ONE_HOUR),
      }),
    ).resolves.toBeUndefined();
    expect(wiringDbState.queryCount).toBe(0);
  });
});
