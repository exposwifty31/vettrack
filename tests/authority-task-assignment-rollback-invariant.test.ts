/**
 * Phase 3 PR 3.3 — Rollback invariant.
 *
 * Flipping `enforce → off` (with the per-clinic config cache flushed) MUST
 * restore byte-identical behavior to the pre-PR-3.3 baseline:
 *   - every input returns `{ action: "allow" }`
 *   - no counter moves
 *
 * In production this matters because the env / per-clinic flag can be flipped
 * for rollback; the system must converge to the previous behavior within one
 * TTL window. This test exercises the convergence by toggling the mode at
 * the call site (matching what production behavior looks like after a flag
 * flip + cache flush).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

import { evaluateTaskAssignment } from "../server/lib/authority/enforcement/task-assignment.evaluator.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type {
  TaskAssignmentContext,
  TaskAssignmentEnforcementMode,
} from "../server/lib/authority/enforcement/result.js";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

function base(overrides: Partial<TaskAssignmentContext> = {}): TaskAssignmentContext {
  return {
    clinicId: "clinic-1",
    now: FIXED_NOW,
    transition: "assign",
    actor: { userId: "actor-vet", role: "vet" },
    target: {
      userId: "target-tech",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    },
    taskType: "medication",
    currentOwnership: { acknowledgedUserId: null, status: "pending" },
    ...overrides,
  };
}

function fixedMode(mode: TaskAssignmentEnforcementMode) {
  return async () => mode;
}

beforeEach(() => {
  resetMetrics();
});

describe("task-assignment rollback invariant", () => {
  it("enforce→off rollback restores byte-identical allow behavior", async () => {
    // Capture counter state before any evaluator activity.
    const before = getMetricsSnapshot().taskAssignmentEnforce;
    expect(before.wouldHaveDenied.actorRole).toBe(0);
    expect(before.denied.actorRole).toBe(0);

    // Simulate post-rollback evaluator invocations. Even with a context that
    // would otherwise deny, off mode allows and emits no counters.
    const offResolver = fixedMode("off");
    for (let i = 0; i < 20; i++) {
      const result = await evaluateTaskAssignment(
        base({ actor: { userId: "tech", role: "technician" } }),
        { modeResolver: offResolver },
      );
      expect(result).toEqual({ action: "allow" });
    }

    // Counters unchanged from the baseline.
    const after = getMetricsSnapshot().taskAssignmentEnforce;
    expect(after.wouldHaveDenied).toEqual(before.wouldHaveDenied);
    expect(after.denied).toEqual(before.denied);
  });

  it("enforce mode produces denials; rollback to off immediately silences them", async () => {
    const enforceResolver = fixedMode("enforce");
    const offResolver = fixedMode("off");
    const ctx = base({ actor: { userId: "tech", role: "technician" } });

    // 1. Enforce produces a deny verdict and bumps the counter.
    const denied = await evaluateTaskAssignment(ctx, { modeResolver: enforceResolver });
    expect(denied).toEqual({ action: "deny", reason: "ACTOR_ROLE_NOT_PERMITTED" });
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.actorRole).toBe(1);

    // 2. Rollback flip: same context, off mode.
    const allowed = await evaluateTaskAssignment(ctx, { modeResolver: offResolver });
    expect(allowed).toEqual({ action: "allow" });

    // 3. Counters do not regress; the enforce-mode bump remains historical,
    //    and off mode adds nothing on top.
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.actorRole).toBe(1);
  });

  it("post-rollback evaluator never touches non-clinic context fields", async () => {
    // Hostile context whose property getters throw if read. With mode=off
    // the evaluator must not inspect them.
    const trap = (name: string) =>
      new Proxy(
        {},
        {
          get(_t, p) {
            throw new Error(`rollback off-mode read ${name}.${String(p)}`);
          },
        },
      );
    const hostile = {
      clinicId: "clinic-1",
      get now(): Date {
        throw new Error("rollback off-mode read ctx.now");
      },
      get transition(): never {
        throw new Error("rollback off-mode read ctx.transition");
      },
      get actor() {
        return trap("actor");
      },
      get target() {
        return trap("target");
      },
      get taskType(): never {
        throw new Error("rollback off-mode read ctx.taskType");
      },
      get currentOwnership() {
        return trap("currentOwnership");
      },
    } as unknown as TaskAssignmentContext;

    const result = await evaluateTaskAssignment(hostile, { modeResolver: fixedMode("off") });
    expect(result).toEqual({ action: "allow" });
  });
});
