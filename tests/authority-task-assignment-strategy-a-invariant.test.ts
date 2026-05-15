/**
 * Phase 3 PR 3.3 — Strategy A invariant (task-assignment evaluator).
 *
 * The PR 7 evaluators preserve Strategy A by short-circuiting on resolver
 * failures (stale.evaluator returns allow on missing checkedInAt, oprole
 * fails-open on cache error). The task-assignment evaluator achieves the
 * same property STRUCTURALLY: it is purely input-driven — no DB reads, no
 * cache reads, no network. If `db` or `authority-cache` are touched at all,
 * the structural invariant is broken.
 *
 * This test mocks both `server/db.js` and `server/lib/authority-cache.js` to
 * throw on ANY access. The evaluator must not touch them.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => {
  const trap = new Proxy(
    {},
    {
      get(_t, p) {
        throw new Error(`task-assignment evaluator touched db.${String(p)} — Strategy A violation`);
      },
    },
  );
  return {
    db: trap,
    users: trap,
    auditLogs: trap,
    eventOutbox: trap,
  };
});

vi.mock("../server/lib/authority-cache.js", () => {
  return new Proxy(
    {},
    {
      get(_t, p) {
        throw new Error(
          `task-assignment evaluator touched authority-cache.${String(p)} — Strategy A violation`,
        );
      },
    },
  );
});

import { evaluateTaskAssignment } from "../server/lib/authority/enforcement/task-assignment.evaluator.js";
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

for (const mode of ["off", "shadow", "enforce"] as const) {
  describe(`task-assignment Strategy A invariant — mode=${mode}`, () => {
    const modeResolver = async (): Promise<TaskAssignmentEnforcementMode> => mode;

    it("runs to completion without touching db or authority-cache (allow case)", async () => {
      await evaluateTaskAssignment(base(), { modeResolver });
    });

    it("runs to completion without touching db or authority-cache (cross-clinic case)", async () => {
      await evaluateTaskAssignment(
        base({
          target: {
            userId: "x",
            role: "technician",
            clinicId: "OTHER",
            status: "active",
            deletedAt: null,
          },
        }),
        { modeResolver },
      );
    });

    it("runs to completion without touching db or authority-cache (blocked target)", async () => {
      await evaluateTaskAssignment(
        base({
          target: {
            userId: "x",
            role: "technician",
            clinicId: "clinic-1",
            status: "blocked",
            deletedAt: null,
          },
        }),
        { modeResolver },
      );
    });

    it("runs to completion without touching db or authority-cache (exclusivity case)", async () => {
      await evaluateTaskAssignment(
        base({
          transition: "acknowledge",
          actor: { userId: "target-tech", role: "technician" },
          currentOwnership: { acknowledgedUserId: "someone-else", status: "in_progress" },
        }),
        { modeResolver },
      );
    });

    // If any of the four cases above threw via the proxy trap, vitest reports
    // the descriptive error message and the suite fails — proving the
    // structural Strategy A property is violated.
    it("structural property holds: evaluator is purely input-driven", () => {
      expect(true).toBe(true);
    });
  });
}
