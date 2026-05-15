/**
 * Phase 3 PR 3.3 — Shadow-mode invariant.
 *
 * For every reason category, shadow mode MUST:
 *   - return `{ action: "allow" }` (never deny)
 *   - increment EXACTLY the matching `wouldHaveDenied` counter
 *   - increment NO `denied` counter
 *   - increment NO counter for any other reason
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
  TaskAssignmentDenyReason,
  TaskAssignmentEnforcementMode,
} from "../server/lib/authority/enforcement/result.js";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

const modeShadow = async (): Promise<TaskAssignmentEnforcementMode> => "shadow";

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

const CASES: ReadonlyArray<{ reason: TaskAssignmentDenyReason; ctx: TaskAssignmentContext }> = [
  {
    reason: "TARGET_CROSS_CLINIC",
    ctx: base({
      target: {
        userId: "x",
        role: "technician",
        clinicId: "OTHER",
        status: "active",
        deletedAt: null,
      },
    }),
  },
  {
    reason: "TARGET_NOT_ACTIVE",
    ctx: base({
      target: {
        userId: "x",
        role: "technician",
        clinicId: "clinic-1",
        status: "blocked",
        deletedAt: null,
      },
    }),
  },
  {
    reason: "ACTOR_ROLE_NOT_PERMITTED",
    ctx: base({ actor: { userId: "tech", role: "technician" } }),
  },
  {
    reason: "TARGET_ROLE_NOT_PERMITTED",
    ctx: base({
      target: {
        userId: "stu",
        role: "student",
        clinicId: "clinic-1",
        status: "active",
        deletedAt: null,
      },
    }),
  },
  {
    reason: "OWNERSHIP_EXCLUSIVITY_VIOLATED",
    ctx: base({
      transition: "acknowledge",
      actor: { userId: "target-tech", role: "technician" },
      currentOwnership: { acknowledgedUserId: "someone-else", status: "in_progress" },
    }),
  },
];

const REASON_TO_FIELD: Record<TaskAssignmentDenyReason, keyof ReturnType<typeof getMetricsSnapshot>["taskAssignmentEnforce"]["wouldHaveDenied"]> = {
  ACTOR_ROLE_NOT_PERMITTED: "actorRole",
  TARGET_CROSS_CLINIC: "targetCrossClinic",
  TARGET_NOT_ACTIVE: "targetNotActive",
  TARGET_ROLE_NOT_PERMITTED: "targetRole",
  OWNERSHIP_EXCLUSIVITY_VIOLATED: "exclusivity",
};

beforeEach(() => {
  resetMetrics();
});

describe("task-assignment shadow-mode invariant", () => {
  for (const c of CASES) {
    it(`${c.reason}: shadow returns allow + increments only the matching wouldHaveDenied counter`, async () => {
      const result = await evaluateTaskAssignment(c.ctx, { modeResolver: modeShadow });
      expect(result).toEqual({ action: "allow" });

      const snap = getMetricsSnapshot().taskAssignmentEnforce;
      const targetField = REASON_TO_FIELD[c.reason];

      // The matching wouldHaveDenied counter incremented exactly once.
      expect(snap.wouldHaveDenied[targetField]).toBe(1);

      // No other wouldHaveDenied counter moved.
      for (const [field, value] of Object.entries(snap.wouldHaveDenied)) {
        if (field === targetField) continue;
        expect(value, `wouldHaveDenied.${field} should be 0`).toBe(0);
      }

      // No `denied` counter moved (we are in shadow, not enforce).
      expect(snap.denied).toEqual({
        actorRole: 0,
        targetCrossClinic: 0,
        targetNotActive: 0,
        targetRole: 0,
        exclusivity: 0,
      });
    });
  }

  it("shadow mode never returns deny across all cases", async () => {
    for (const c of CASES) {
      const r = await evaluateTaskAssignment(c.ctx, { modeResolver: modeShadow });
      expect(r.action).toBe("allow");
    }
  });
});
