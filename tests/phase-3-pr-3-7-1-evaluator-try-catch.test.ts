/**
 * Phase 3 PR 3.7.1 — Evaluator try/catch regression.
 *
 * Covers Cursor Bugbot Medium finding on PR 3.7: the
 * `applyStaleTaskOwnershipObservation` helper had an observation-only
 * contract (§12.4) but the `evaluateStaleTaskOwnership` calls were not
 * wrapped in try/catch. An unexpected evaluator throw would propagate
 * up through `startTask`/`completeTask` and fail user-facing
 * operations.
 *
 * Fix: wrap the evaluator calls in try/catch. Unexpected throws are
 * logged and suppressed; the helper returns normally (degrades to
 * allow). The intentional PR 3.8 `STALE_OWNERSHIP_DENIED` throw is
 * NOT affected — it lives outside the try block, fired by inspecting
 * the verdict value rather than from inside the evaluator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { targetRows } = vi.hoisted(() => {
  // `dbShouldThrow`: when true, db.select().from().where().limit() throws.
  // This forces the wiring's loadOwnerCheckInEndedAtForStaleness catch
  // path so the degraded-mode fallback is exercised end-to-end.
  const targetRows: { next?: unknown[]; dbShouldThrow?: boolean } = {};
  return { targetRows };
});

vi.mock("../server/db.js", () => {
  const throwingLimit = async () => {
    if (targetRows.dbShouldThrow) {
      throw new Error("db.select threw — forcing degraded-mode fallback");
    }
    return targetRows.next ?? [];
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: throwingLimit }),
          limit: throwingLimit,
        }),
      }),
    }),
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

const mockEvaluateStaleTaskOwnership = vi.fn();
vi.mock("../server/lib/authority/enforcement/stale-task-ownership.evaluator.js", () => ({
  evaluateStaleTaskOwnership: (...args: unknown[]) => mockEvaluateStaleTaskOwnership(...args),
}));

import { applyStaleTaskOwnershipObservation } from "../server/services/appointments.service.js";

const PAST_GRACE = new Date("2026-05-15T08:00:00Z");

beforeEach(() => {
  targetRows.next = [{ checkedOutAt: PAST_GRACE }];
  targetRows.dbShouldThrow = false;
  mockResolveStaleMode.mockReset();
  mockResolveTaskAssignmentMode.mockReset();
  mockEvaluateStaleTaskOwnership.mockReset();
});

describe("PR 3.7.1 — evaluator try/catch (observation-only contract)", () => {
  it("evaluator throws under shadow mode → helper resolves without throwing", async () => {
    mockResolveStaleMode.mockResolvedValue("shadow");
    mockEvaluateStaleTaskOwnership.mockRejectedValue(new Error("evaluator pathological"));
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date("2026-05-15T07:00:00Z"),
        status: "in_progress",
        updatedAt: new Date("2026-05-15T07:00:00Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("evaluator throws under enforce mode → helper resolves without throwing (NOT a STALE_OWNERSHIP_DENIED)", async () => {
    // Pre-PR-3.7.1 behavior: the throw from inside the evaluator would
    // propagate as a 500 to the user. After PR 3.7.1: observation
    // suppresses the throw and degrades to allow. The intentional
    // STALE_OWNERSHIP_DENIED is fired from the verdict inspection, so
    // when the evaluator throws, there is no verdict and no deny.
    mockResolveStaleMode.mockResolvedValue("enforce");
    mockEvaluateStaleTaskOwnership.mockRejectedValue(new Error("evaluator pathological"));
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(),
        status: "in_progress",
        updatedAt: new Date("2026-05-15T07:00:00Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("intentional STALE_OWNERSHIP_DENIED throw IS preserved (lives outside the try block)", async () => {
    mockResolveStaleMode.mockResolvedValue("enforce");
    // Evaluator returns would_revoke normally (does not throw)
    mockEvaluateStaleTaskOwnership.mockResolvedValue({
      action: "would_revoke",
      reason: "STALE_OWNERSHIP",
    });
    let thrown: unknown = null;
    try {
      await applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(),
        status: "in_progress",
        updatedAt: new Date("2026-05-15T07:00:00Z"),
      });
    } catch (e) {
      thrown = e;
    }
    // The intentional throw still fires.
    expect((thrown as { code?: string })?.code).toBe("STALE_OWNERSHIP_DENIED");
  });

  it("evaluator throws in degraded-mode fallback path → helper resolves without throwing", async () => {
    // Force the actual degraded-mode path: make the check-in lookup
    // throw, which triggers the `loadOwnerCheckInEndedAtForStaleness`
    // catch in the wiring helper. The evaluator inside the degraded
    // branch ALSO throws — proving the inner try/catch around the
    // degraded-path evaluator call works end-to-end.
    mockResolveStaleMode.mockResolvedValue("shadow");
    targetRows.dbShouldThrow = true;
    mockEvaluateStaleTaskOwnership.mockRejectedValue(new Error("evaluator pathological"));
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(),
        status: "in_progress",
        updatedAt: new Date("2026-05-15T07:00:00Z"),
      }),
    ).resolves.toBeUndefined();
    // The degraded-mode branch was reached: evaluator was called with
    // resolverOperational=false.
    expect(mockEvaluateStaleTaskOwnership).toHaveBeenCalled();
    const arg = mockEvaluateStaleTaskOwnership.mock.calls[0]?.[0] as { resolverOperational?: boolean };
    expect(arg?.resolverOperational).toBe(false);
  });

  it("evaluator returns allow in degraded-mode fallback path → helper resolves without throwing", async () => {
    // Same degraded-path setup as above but the evaluator returns
    // allow (its expected behavior in the degraded path — it records
    // degradedModePause and returns allow).
    mockResolveStaleMode.mockResolvedValue("enforce");
    targetRows.dbShouldThrow = true;
    mockEvaluateStaleTaskOwnership.mockResolvedValue({
      action: "allow",
      protected: "DEGRADED_MODE",
    });
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(),
        status: "in_progress",
        updatedAt: new Date("2026-05-15T07:00:00Z"),
      }),
    ).resolves.toBeUndefined();
    // Confirm the degraded branch was reached.
    const arg = mockEvaluateStaleTaskOwnership.mock.calls[0]?.[0] as { resolverOperational?: boolean };
    expect(arg?.resolverOperational).toBe(false);
  });

  it("off mode is untouched by the wrap (no evaluator call)", async () => {
    mockResolveStaleMode.mockResolvedValue("off");
    await expect(
      applyStaleTaskOwnershipObservation({
        clinicId: "clinic-1",
        taskId: "task-1",
        acknowledgedUserId: "tech-1",
        acknowledgedAt: new Date(),
        status: "in_progress",
        updatedAt: new Date("2026-05-15T07:00:00Z"),
      }),
    ).resolves.toBeUndefined();
    expect(mockEvaluateStaleTaskOwnership).not.toHaveBeenCalled();
  });
});
