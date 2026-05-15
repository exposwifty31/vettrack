/**
 * Phase 3 PR 3.3 — Task-assignment evaluator unit tests.
 *
 * Pure-function tests over (mode, context). No DB. No cache. Mode resolver
 * is injected via options; production env vars are not touched.
 *
 * POLICY NOTE: PR 3.3 mirrors current `task-rbac.ts` policy — assign /
 * reassign permitted for admin, vet, senior_technician. Any future
 * tightening to admin/vet only must be a separate policy-change PR.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent side effects from importing db.ts via the audit chain.
vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

import {
  computeTaskAssignmentDeny,
  evaluateTaskAssignment,
} from "../server/lib/authority/enforcement/task-assignment.evaluator.js";
import {
  getMetricsSnapshot,
  resetMetrics,
} from "../server/lib/metrics.js";
import type {
  TaskAssignmentContext,
  TaskAssignmentEnforcementMode,
} from "../server/lib/authority/enforcement/result.js";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

function baseContext(overrides: Partial<TaskAssignmentContext> = {}): TaskAssignmentContext {
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

function modeResolver(mode: TaskAssignmentEnforcementMode) {
  return async () => mode;
}

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// computeTaskAssignmentDeny — pure helper

describe("computeTaskAssignmentDeny — permitted transitions", () => {
  it("vet assigns medication task to active in-clinic technician → null", () => {
    expect(computeTaskAssignmentDeny(baseContext())).toBeNull();
  });

  it("admin reassigns to a different active in-clinic technician → null", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          actor: { userId: "actor-admin", role: "admin" },
          transition: "reassign",
          currentOwnership: { acknowledgedUserId: "old-tech", status: "assigned" },
        }),
      ),
    ).toBeNull();
  });

  it("senior_technician can assign — mirrors existing task-rbac policy (PR 3.3 inert foundation)", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({ actor: { userId: "actor-st", role: "senior_technician" } }),
      ),
    ).toBeNull();
  });

  it("self-acknowledge of an unowned task → null", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          transition: "acknowledge",
          actor: { userId: "target-tech", role: "technician" },
          currentOwnership: { acknowledgedUserId: null, status: "assigned" },
        }),
      ),
    ).toBeNull();
  });

  it("idempotent re-acknowledge by current owner → null", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          transition: "acknowledge",
          actor: { userId: "target-tech", role: "technician" },
          currentOwnership: { acknowledgedUserId: "target-tech", status: "in_progress" },
        }),
      ),
    ).toBeNull();
  });

  it("reassign-to-current-owner is allow (per decision B — route handler short-circuits)", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          actor: { userId: "actor-admin", role: "admin" },
          transition: "reassign",
          target: {
            userId: "same-tech",
            role: "technician",
            clinicId: "clinic-1",
            status: "active",
            deletedAt: null,
          },
          currentOwnership: { acknowledgedUserId: "same-tech", status: "assigned" },
        }),
      ),
    ).toBeNull();
  });
});

describe("computeTaskAssignmentDeny — TARGET_CROSS_CLINIC", () => {
  it("target in different clinic is rejected (first-precedence)", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          target: {
            userId: "x",
            role: "technician",
            clinicId: "clinic-2",
            status: "active",
            deletedAt: null,
          },
        }),
      ),
    ).toBe("TARGET_CROSS_CLINIC");
  });

  it("cross-clinic precedes other failures", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          actor: { userId: "actor-student", role: "student" }, // would also be ACTOR_ROLE_NOT_PERMITTED
          target: {
            userId: "x",
            role: "student", // would also be TARGET_ROLE_NOT_PERMITTED
            clinicId: "clinic-2", // cross-clinic wins
            status: "blocked", // would also be TARGET_NOT_ACTIVE
            deletedAt: null,
          },
        }),
      ),
    ).toBe("TARGET_CROSS_CLINIC");
  });
});

describe("computeTaskAssignmentDeny — TARGET_NOT_ACTIVE", () => {
  it("blocked target → TARGET_NOT_ACTIVE", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          target: {
            userId: "x",
            role: "technician",
            clinicId: "clinic-1",
            status: "blocked",
            deletedAt: null,
          },
        }),
      ),
    ).toBe("TARGET_NOT_ACTIVE");
  });

  it("pending target → TARGET_NOT_ACTIVE", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          target: {
            userId: "x",
            role: "technician",
            clinicId: "clinic-1",
            status: "pending",
            deletedAt: null,
          },
        }),
      ),
    ).toBe("TARGET_NOT_ACTIVE");
  });

  it("soft-deleted target → TARGET_NOT_ACTIVE", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          target: {
            userId: "x",
            role: "technician",
            clinicId: "clinic-1",
            status: "active",
            deletedAt: new Date("2026-01-01T00:00:00Z"),
          },
        }),
      ),
    ).toBe("TARGET_NOT_ACTIVE");
  });
});

describe("computeTaskAssignmentDeny — ACTOR_ROLE_NOT_PERMITTED", () => {
  it("technician cannot assign others → ACTOR_ROLE_NOT_PERMITTED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({ actor: { userId: "actor-tech", role: "technician" } }),
      ),
    ).toBe("ACTOR_ROLE_NOT_PERMITTED");
  });

  it("student cannot assign → ACTOR_ROLE_NOT_PERMITTED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({ actor: { userId: "actor-student", role: "student" } }),
      ),
    ).toBe("ACTOR_ROLE_NOT_PERMITTED");
  });

  it("technician cannot reassign → ACTOR_ROLE_NOT_PERMITTED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          actor: { userId: "actor-tech", role: "technician" },
          transition: "reassign",
          currentOwnership: { acknowledgedUserId: "old-tech", status: "assigned" },
        }),
      ),
    ).toBe("ACTOR_ROLE_NOT_PERMITTED");
  });

  it("acknowledge by someone other than target (even admin) → ACTOR_ROLE_NOT_PERMITTED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          transition: "acknowledge",
          actor: { userId: "actor-admin", role: "admin" },
          target: {
            userId: "target-tech",
            role: "technician",
            clinicId: "clinic-1",
            status: "active",
            deletedAt: null,
          },
        }),
      ),
    ).toBe("ACTOR_ROLE_NOT_PERMITTED");
  });
});

describe("computeTaskAssignmentDeny — TARGET_ROLE_NOT_PERMITTED", () => {
  it("student target on medication task → TARGET_ROLE_NOT_PERMITTED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          target: {
            userId: "target-student",
            role: "student",
            clinicId: "clinic-1",
            status: "active",
            deletedAt: null,
          },
        }),
      ),
    ).toBe("TARGET_ROLE_NOT_PERMITTED");
  });

  it("student target on non-medication task → TARGET_ROLE_NOT_PERMITTED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          taskType: "maintenance",
          target: {
            userId: "target-student",
            role: "student",
            clinicId: "clinic-1",
            status: "active",
            deletedAt: null,
          },
        }),
      ),
    ).toBe("TARGET_ROLE_NOT_PERMITTED");
  });

  it("technician target on medication task → null (technicians can perform med tasks)", () => {
    expect(computeTaskAssignmentDeny(baseContext())).toBeNull();
  });
});

describe("computeTaskAssignmentDeny — OWNERSHIP_EXCLUSIVITY_VIOLATED", () => {
  it("acknowledge of task already owned by someone else → OWNERSHIP_EXCLUSIVITY_VIOLATED", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          transition: "acknowledge",
          actor: { userId: "target-tech", role: "technician" },
          currentOwnership: { acknowledgedUserId: "other-tech", status: "in_progress" },
        }),
      ),
    ).toBe("OWNERSHIP_EXCLUSIVITY_VIOLATED");
  });

  it("acknowledge with no current owner → null", () => {
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          transition: "acknowledge",
          actor: { userId: "target-tech", role: "technician" },
          currentOwnership: { acknowledgedUserId: null, status: "assigned" },
        }),
      ),
    ).toBeNull();
  });

  it("assign mutations are NOT subject to exclusivity (only acknowledge is)", () => {
    // §3.3: reassign is non-transitive — it revokes the current owner; the new
    // owner must re-acknowledge separately. So the assign/reassign mutation
    // itself does NOT need exclusivity; the acknowledge step does.
    expect(
      computeTaskAssignmentDeny(
        baseContext({
          transition: "reassign",
          actor: { userId: "actor-admin", role: "admin" },
          currentOwnership: { acknowledgedUserId: "old-owner", status: "in_progress" },
        }),
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateTaskAssignment — full evaluator with mode

describe("evaluateTaskAssignment — off mode", () => {
  it("off mode always returns allow regardless of context", async () => {
    const result = await evaluateTaskAssignment(
      baseContext({
        actor: { userId: "actor-student", role: "student" },
        target: {
          userId: "x",
          role: "student",
          clinicId: "OTHER-CLINIC",
          status: "blocked",
          deletedAt: new Date(),
        },
      }),
      { modeResolver: modeResolver("off") },
    );
    expect(result).toEqual({ action: "allow" });
  });

  it("off mode does not increment any counter", async () => {
    await evaluateTaskAssignment(
      baseContext({
        target: {
          userId: "x",
          role: "technician",
          clinicId: "OTHER-CLINIC",
          status: "active",
          deletedAt: null,
        },
      }),
      { modeResolver: modeResolver("off") },
    );
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

describe("evaluateTaskAssignment — shadow mode", () => {
  it("shadow mode NEVER returns deny", async () => {
    const result = await evaluateTaskAssignment(
      baseContext({
        target: {
          userId: "x",
          role: "technician",
          clinicId: "OTHER-CLINIC",
          status: "active",
          deletedAt: null,
        },
      }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(result).toEqual({ action: "allow" });
  });

  it("shadow mode increments the matching wouldHaveDenied counter", async () => {
    await evaluateTaskAssignment(
      baseContext({
        target: {
          userId: "x",
          role: "technician",
          clinicId: "OTHER-CLINIC",
          status: "active",
          deletedAt: null,
        },
      }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetCrossClinic).toBe(1);
  });

  it("shadow mode increments actorRole counter for unauthorized actor", async () => {
    await evaluateTaskAssignment(
      baseContext({ actor: { userId: "tech", role: "technician" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.actorRole).toBe(1);
  });

  it("shadow mode does not move any 'denied' counter", async () => {
    await evaluateTaskAssignment(
      baseContext({ actor: { userId: "tech", role: "technician" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied).toEqual({
      actorRole: 0,
      targetCrossClinic: 0,
      targetNotActive: 0,
      targetRole: 0,
      exclusivity: 0,
    });
  });

  it("shadow mode returns allow even when context is fully valid", async () => {
    const result = await evaluateTaskAssignment(baseContext(), {
      modeResolver: modeResolver("shadow"),
    });
    expect(result).toEqual({ action: "allow" });
  });
});

describe("evaluateTaskAssignment — enforce mode", () => {
  it("enforce mode returns deny with the matching reason", async () => {
    const result = await evaluateTaskAssignment(
      baseContext({ actor: { userId: "tech", role: "technician" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(result).toEqual({ action: "deny", reason: "ACTOR_ROLE_NOT_PERMITTED" });
  });

  it("enforce mode increments the matching denied counter", async () => {
    await evaluateTaskAssignment(
      baseContext({
        target: {
          userId: "x",
          role: "technician",
          clinicId: "clinic-1",
          status: "blocked",
          deletedAt: null,
        },
      }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.targetNotActive).toBe(1);
  });

  it("enforce mode allows a fully valid context", async () => {
    const result = await evaluateTaskAssignment(baseContext(), {
      modeResolver: modeResolver("enforce"),
    });
    expect(result).toEqual({ action: "allow" });
  });

  it("enforce mode allows reassign-to-current-owner (decision B — semantic no-op)", async () => {
    const result = await evaluateTaskAssignment(
      baseContext({
        actor: { userId: "actor-admin", role: "admin" },
        transition: "reassign",
        target: {
          userId: "same-tech",
          role: "technician",
          clinicId: "clinic-1",
          status: "active",
          deletedAt: null,
        },
        currentOwnership: { acknowledgedUserId: "same-tech", status: "assigned" },
      }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(result).toEqual({ action: "allow" });
  });
});
