/**
 * Phase 3 PR 3.8.1 — Audit-guard regression test.
 *
 * Regression for the §13.7 transactional-audit invariant. The original
 * PR 3.8 emitter had two observability gates that returned `undefined`
 * before reaching `logAudit`:
 *   - the `AUTHORITY_OBS_V1` env flag
 *   - the per-task rate limiter (createLogLimiter)
 *
 * When either fired during a live revocation, the sweeper's
 * `if (auditPromise && ...)` check skipped the await and the
 * transaction committed the ownership UPDATE without the audit row.
 *
 * Fix: `emitStaleTaskOwnershipRevokedAudit` now accepts `force: true`
 * which bypasses BOTH gates. The sweeper passes `force: true` so live
 * revocations are unconditionally audited (or the transaction rolls
 * back).
 *
 * This test mocks `logAudit` and asserts it is INVOKED on every
 * force-true emission regardless of the observability flag or the
 * rate-limiter state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

// Don't actually rate-limit during the test — we want each call to be
// independently audited. The shadow path still uses the limiter under
// force=false; force=true bypasses it.
vi.mock("../server/lib/log-safety.js", () => ({
  createLogLimiter: () => ({
    shouldLog: () => false, // ALWAYS RATE-LIMITED — proves force bypasses
    reset: () => undefined,
  }),
}));

import { emitStaleTaskOwnershipRevokedAudit } from "../server/lib/authority/enforcement/stale-task-ownership.audit.js";

beforeEach(() => {
  mockLogAudit.mockReset();
  delete process.env.AUTHORITY_OBS_V1;
});

describe("PR 3.8.1 — audit-guard regression", () => {
  it("force=true bypasses AUTHORITY_OBS_V1 even when unset", () => {
    // OBS_V1 is unset → without force, this would silently return undefined.
    expect(process.env.AUTHORITY_OBS_V1).toBeUndefined();
    emitStaleTaskOwnershipRevokedAudit({
      clinicId: "c1",
      taskId: "t1",
      ownerUserId: "u1",
      ownerCheckInEndedAt: new Date("2026-05-15T10:00:00Z"),
      taskUpdatedAt: new Date("2026-05-15T08:00:00Z"),
      graceWindowMs: 15 * 60_000,
      activityWindowMs: 5 * 60_000,
      previousStatus: "in_progress",
      newStatus: "assigned",
      force: true,
    });
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses the rate-limiter (mocked to always block)", () => {
    process.env.AUTHORITY_OBS_V1 = "true";
    // Limiter is mocked to return shouldLog: false. force=true must
    // still emit. Without force, the limiter would block and the
    // emission would silently skip.
    emitStaleTaskOwnershipRevokedAudit({
      clinicId: "c1",
      taskId: "t1",
      ownerUserId: "u1",
      ownerCheckInEndedAt: new Date("2026-05-15T10:00:00Z"),
      taskUpdatedAt: new Date("2026-05-15T08:00:00Z"),
      graceWindowMs: 15 * 60_000,
      activityWindowMs: 5 * 60_000,
      previousStatus: "in_progress",
      newStatus: "assigned",
      force: true,
    });
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it("force=true 100 invocations all emit (no rate-limit blackholing)", () => {
    process.env.AUTHORITY_OBS_V1 = "true";
    for (let i = 0; i < 100; i++) {
      emitStaleTaskOwnershipRevokedAudit({
        clinicId: "c1",
        taskId: `t-${i}`,
        ownerUserId: "u1",
        ownerCheckInEndedAt: new Date(),
        taskUpdatedAt: new Date(),
        graceWindowMs: 15 * 60_000,
        activityWindowMs: 5 * 60_000,
        previousStatus: "in_progress",
        newStatus: "assigned",
        force: true,
      });
    }
    expect(mockLogAudit).toHaveBeenCalledTimes(100);
  });

  it("force=false (shadow path) respects rate-limiter (proves the gate still applies for non-force callers)", () => {
    process.env.AUTHORITY_OBS_V1 = "true";
    emitStaleTaskOwnershipRevokedAudit({
      clinicId: "c1",
      taskId: "t1",
      ownerUserId: "u1",
      ownerCheckInEndedAt: new Date(),
      taskUpdatedAt: new Date(),
      graceWindowMs: 15 * 60_000,
      activityWindowMs: 5 * 60_000,
      previousStatus: "in_progress",
      newStatus: "assigned",
      // no force
    });
    // Rate limiter (mocked to block) prevented emission.
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("force=false without OBS_V1 (default) does not emit", () => {
    // Default: OBS_V1 unset → no emission for non-force callers.
    emitStaleTaskOwnershipRevokedAudit({
      clinicId: "c1",
      taskId: "t1",
      ownerUserId: "u1",
      ownerCheckInEndedAt: new Date(),
      taskUpdatedAt: new Date(),
      graceWindowMs: 15 * 60_000,
      activityWindowMs: 5 * 60_000,
      previousStatus: "in_progress",
      newStatus: "assigned",
      // no force
    });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("force=true with missing clinicId throws (rolls back the caller's transaction)", () => {
    expect(() =>
      emitStaleTaskOwnershipRevokedAudit({
        clinicId: "",
        taskId: "t1",
        ownerUserId: "u1",
        ownerCheckInEndedAt: new Date(),
        taskUpdatedAt: new Date(),
        graceWindowMs: 15 * 60_000,
        activityWindowMs: 5 * 60_000,
        previousStatus: "in_progress",
        newStatus: "assigned",
        force: true,
      }),
    ).toThrow(/clinicId and taskId are required when force=true/);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("force=true with missing taskId throws", () => {
    expect(() =>
      emitStaleTaskOwnershipRevokedAudit({
        clinicId: "c1",
        taskId: "",
        ownerUserId: "u1",
        ownerCheckInEndedAt: new Date(),
        taskUpdatedAt: new Date(),
        graceWindowMs: 15 * 60_000,
        activityWindowMs: 5 * 60_000,
        previousStatus: "in_progress",
        newStatus: "assigned",
        force: true,
      }),
    ).toThrow(/clinicId and taskId are required when force=true/);
  });

  it("force=false with missing clinicId silently returns (existing observability semantics preserved)", () => {
    process.env.AUTHORITY_OBS_V1 = "true";
    expect(() =>
      emitStaleTaskOwnershipRevokedAudit({
        clinicId: "",
        taskId: "t1",
        ownerUserId: "u1",
        ownerCheckInEndedAt: new Date(),
        taskUpdatedAt: new Date(),
        graceWindowMs: 15 * 60_000,
        activityWindowMs: 5 * 60_000,
        previousStatus: "in_progress",
        newStatus: "assigned",
        // no force
      }),
    ).not.toThrow();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("force=true with tx returns the logAudit Promise (so caller can await/rollback)", () => {
    const fakeTx = {} as never;
    mockLogAudit.mockResolvedValue(undefined);
    const result = emitStaleTaskOwnershipRevokedAudit({
      clinicId: "c1",
      taskId: "t1",
      ownerUserId: "u1",
      ownerCheckInEndedAt: new Date(),
      taskUpdatedAt: new Date(),
      graceWindowMs: 15 * 60_000,
      activityWindowMs: 5 * 60_000,
      previousStatus: "in_progress",
      newStatus: "assigned",
      tx: fakeTx,
      force: true,
    });
    // logAudit returns a promise when called with tx; the emitter
    // returns that promise so the transactional caller can await it.
    expect(result).toBeDefined();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tx: fakeTx, actionType: "stale_task_ownership_revoked" }),
    );
  });
});
