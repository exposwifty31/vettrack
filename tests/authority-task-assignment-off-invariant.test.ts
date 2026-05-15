/**
 * Phase 3 PR 3.3 — Off-mode invariant.
 *
 * In `off` mode the evaluator MUST behave as a no-op. It must not read any
 * field of the context beyond what's needed to call the mode resolver (only
 * clinicId), must not increment any counter, must not emit any audit row,
 * and must return `{ action: "allow" }` for every input.
 *
 * Concretely: we construct a hostile context whose property getters throw if
 * touched, and assert the evaluator still returns allow without throwing.
 */
import { describe, expect, it, vi } from "vitest";

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

function modeOff(): (clinicId: string) => Promise<TaskAssignmentEnforcementMode> {
  return async () => "off";
}

/**
 * Hostile context: every property except `clinicId` throws on access. If the
 * evaluator's off path is truly inert (per the structural-invariant contract)
 * the test passes; any inspection causes a thrown error and a test failure.
 */
function hostileContext(): TaskAssignmentContext {
  const trap = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, p) {
          throw new Error(`off mode read ${name}.${String(p)}`);
        },
      },
    );
  return {
    clinicId: "clinic-x",
    get now(): Date {
      throw new Error("off mode read ctx.now");
    },
    get transition(): never {
      throw new Error("off mode read ctx.transition");
    },
    get actor() {
      return trap("actor") as TaskAssignmentContext["actor"];
    },
    get target() {
      return trap("target") as TaskAssignmentContext["target"];
    },
    get taskType(): never {
      throw new Error("off mode read ctx.taskType");
    },
    get currentOwnership() {
      return trap("currentOwnership") as TaskAssignmentContext["currentOwnership"];
    },
  } as unknown as TaskAssignmentContext;
}

describe("task-assignment off-mode invariant", () => {
  it("off mode returns allow without inspecting any context field beyond clinicId", async () => {
    resetMetrics();
    const result = await evaluateTaskAssignment(hostileContext(), {
      modeResolver: modeOff(),
    });
    expect(result).toEqual({ action: "allow" });
  });

  it("off mode does not move ANY task-assignment counter across 100 invocations", async () => {
    resetMetrics();
    for (let i = 0; i < 100; i++) {
      await evaluateTaskAssignment(hostileContext(), { modeResolver: modeOff() });
    }
    const snap = getMetricsSnapshot().taskAssignmentEnforce;
    expect(snap.wouldHaveDenied).toEqual({
      actorRole: 0,
      targetCrossClinic: 0,
      targetNotActive: 0,
      targetRole: 0,
      exclusivity: 0,
    });
    expect(snap.denied).toEqual({
      actorRole: 0,
      targetCrossClinic: 0,
      targetNotActive: 0,
      targetRole: 0,
      exclusivity: 0,
    });
  });
});
