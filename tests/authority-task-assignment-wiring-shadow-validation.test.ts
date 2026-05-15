/**
 * Phase 3 PR 3.5 — Shadow rollout validation.
 *
 * This file adds VALIDATION coverage on top of the PR 3.4 wiring tests. It
 * does NOT introduce new metrics, new audit surface, new wiring, or new
 * evaluator surface. Per §10.5 / §10.6 of the master plan, PR 3.5 may only
 * consume and validate existing metrics and audit surfaces.
 *
 * What this file adds beyond PR 3.4 wiring tests:
 *   1. Drift coverage at the helper level for the §10.8 cases:
 *      - senior_technician assign / reassign drift
 *      - blocked-user assignment drift
 *      - exclusivity drift in shadow
 *   2. Audit suppression: prove `emitTaskAssignmentDenialAudit` (PR 3.3) is
 *      NEVER called in shadow mode, even when the verdict would deny.
 *   3. Rollback rehearsal: explicit shadow → off invariant proven against
 *      the live wiring helper, with the per-transition assertions.
 *
 * No source files are modified by PR 3.5. This is validation-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { targetRows } = vi.hoisted(() => {
  const targetRows: Record<string, unknown> = {};
  return { targetRows };
});

vi.mock("../server/db.js", () => {
  const db = {
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_clause: unknown) => ({
          limit: async (_n: number) => {
            const next = targetRows.next ?? null;
            return next ? [next] : [];
          },
        }),
      }),
    }),
  };
  return {
    db,
    users: { id: "u.id", role: "u.role", clinicId: "u.clinicId", status: "u.status", deletedAt: "u.deletedAt" },
    appointments: {},
    auditLogs: {},
    eventOutbox: {},
    animals: {},
    billingItems: {},
    billingLedger: {},
    containers: {},
    inventoryJobs: {},
    owners: {},
    shifts: {},
  };
});

const mockResolveMode = vi.fn();
vi.mock("../server/lib/authority/enforcement/config.js", () => ({
  resolveTaskAssignmentEnforcementMode: (...args: unknown[]) => mockResolveMode(...args),
}));

// Audit-suppression spy: prove the PR 3.3 evaluator's audit emitter is NEVER
// reached in shadow mode. The evaluator's enforce branch guards the call;
// reaching this spy in shadow would be a contract violation.
const mockEmitTaskAssignmentDenialAudit = vi.fn();
vi.mock("../server/lib/authority/enforcement/task-assignment.audit.js", () => ({
  emitTaskAssignmentDenialAudit: (...args: unknown[]) => mockEmitTaskAssignmentDenialAudit(...args),
}));

import { applyTaskAssignmentEvaluator } from "../server/services/appointments.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

beforeEach(() => {
  mockResolveMode.mockReset();
  mockEmitTaskAssignmentDenialAudit.mockReset();
  targetRows.next = undefined;
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.8 Drift coverage

describe("PR 3.5 shadow-mode drift coverage — senior_technician assign / reassign", () => {
  it("senior_technician assigning in shadow → allow (matches existing task-rbac policy, no drift surfaces)", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-1",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "st-1", email: "s@e", role: "senior_technician" },
      targetUserId: "tech-1",
      transition: "assign",
      taskType: "medication",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    // senior_technician is permitted to assign per task-rbac.ts. PR 3.3 §A
    // decision mirrors this policy. No drift surfaces.
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.actorRole).toBe(0);
  });

  it("senior_technician reassigning in shadow → allow (no drift)", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-new",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "st-1", email: "s@e", role: "senior_technician" },
      targetUserId: "tech-new",
      transition: "reassign",
      taskType: "medication",
      currentAcknowledgedUserId: "tech-old",
      currentStatus: "assigned",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.actorRole).toBe(0);
  });

  it("technician (NOT senior) assigning in shadow → actorRole drift visible", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-2",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "tech-1", email: "t@e", role: "technician" },
      targetUserId: "tech-2",
      transition: "assign",
      taskType: "medication",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.actorRole).toBe(1);
  });
});

describe("PR 3.5 shadow-mode drift coverage — blocked user assignment", () => {
  it("blocked target → targetNotActive drift", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-blocked",
      role: "technician",
      clinicId: "clinic-1",
      status: "blocked",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "vet-1", email: "v@e", role: "vet" },
      targetUserId: "tech-blocked",
      transition: "assign",
      taskType: "medication",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetNotActive).toBe(1);
  });

  it("soft-deleted target → targetNotActive drift", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-deleted",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "vet-1", email: "v@e", role: "vet" },
      targetUserId: "tech-deleted",
      transition: "assign",
      taskType: "medication",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetNotActive).toBe(1);
  });
});

describe("PR 3.5 shadow-mode drift coverage — exclusivity", () => {
  it("acknowledge of task already owned by another user → exclusivity drift", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-self",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "tech-self", email: "t@e", role: "technician" },
      targetUserId: "tech-self",
      transition: "acknowledge",
      taskType: "medication",
      currentAcknowledgedUserId: "tech-other",
      currentStatus: "in_progress",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.exclusivity).toBe(1);
  });

  it("re-ack by current owner → no exclusivity drift (idempotent re-ack)", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-self",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "tech-self", email: "t@e", role: "technician" },
      targetUserId: "tech-self",
      transition: "acknowledge",
      taskType: "medication",
      currentAcknowledgedUserId: "tech-self",
      currentStatus: "in_progress",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.exclusivity).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.6 Audit suppression in shadow

describe("PR 3.5 audit suppression — shadow never emits denial audit rows", () => {
  it("shadow with would-deny verdict: emitTaskAssignmentDenialAudit is NOT called", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "tech-blocked",
      role: "technician",
      clinicId: "clinic-1",
      status: "blocked",
      deletedAt: null,
    };
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "vet-1", email: "v@e", role: "vet" },
      targetUserId: "tech-blocked",
      transition: "assign",
      taskType: "medication",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    expect(mockEmitTaskAssignmentDenialAudit).not.toHaveBeenCalled();
  });

  it("shadow across all three transitions × all five reason categories: zero audit emissions", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    const scenarios = [
      {
        // ACTOR_ROLE_NOT_PERMITTED
        target: { id: "x", role: "technician", clinicId: "clinic-1", status: "active", deletedAt: null },
        actor: { userId: "tech", email: "t@e", role: "technician" },
        transition: "assign" as const,
      },
      {
        // TARGET_CROSS_CLINIC
        target: { id: "x", role: "technician", clinicId: "OTHER", status: "active", deletedAt: null },
        actor: { userId: "vet", email: "v@e", role: "vet" },
        transition: "reassign" as const,
      },
      {
        // TARGET_NOT_ACTIVE
        target: { id: "x", role: "technician", clinicId: "clinic-1", status: "blocked", deletedAt: null },
        actor: { userId: "vet", email: "v@e", role: "vet" },
        transition: "assign" as const,
      },
      {
        // TARGET_ROLE_NOT_PERMITTED
        target: { id: "x", role: "student", clinicId: "clinic-1", status: "active", deletedAt: null },
        actor: { userId: "vet", email: "v@e", role: "vet" },
        transition: "assign" as const,
      },
      {
        // OWNERSHIP_EXCLUSIVITY_VIOLATED
        target: { id: "tech-self", role: "technician", clinicId: "clinic-1", status: "active", deletedAt: null },
        actor: { userId: "tech-self", email: "t@e", role: "technician" },
        transition: "acknowledge" as const,
      },
    ];

    for (const s of scenarios) {
      targetRows.next = s.target;
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: s.actor,
        targetUserId: s.target.id,
        transition: s.transition,
        taskType: "medication",
        currentAcknowledgedUserId: s.transition === "acknowledge" ? "other-owner" : null,
        currentStatus: s.transition === "acknowledge" ? "in_progress" : "pending",
      });
    }
    expect(mockEmitTaskAssignmentDenialAudit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.8 Response-payload preservation — shadow never throws

describe("PR 3.5 shadow preserves response payloads — never throws", () => {
  it("shadow with would-deny: applyTaskAssignmentEvaluator resolves (no throw)", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "x",
      role: "student",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "vet", email: "v@e", role: "vet" },
        targetUserId: "x",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
  });

  it("shadow across 30 consecutive would-deny invocations: never throws", async () => {
    mockResolveMode.mockResolvedValue("shadow");
    targetRows.next = {
      id: "x",
      role: "technician",
      clinicId: "OTHER", // cross-clinic → would-deny every iteration
      status: "active",
      deletedAt: null,
    };
    for (let i = 0; i < 30; i++) {
      await expect(
        applyTaskAssignmentEvaluator({
          clinicId: "clinic-1",
          actor: { userId: "vet", email: "v@e", role: "vet" },
          targetUserId: "x",
          transition: "assign",
          taskType: "medication",
          currentAcknowledgedUserId: null,
          currentStatus: "pending",
        }),
      ).resolves.toBeUndefined();
    }
    // 30 would-deny invocations should have moved the cross-clinic counter
    // exactly 30 times, confirming the per-invocation increment contract.
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetCrossClinic).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.7 Rollback rehearsal — shadow → off

describe("PR 3.5 rollback rehearsal — shadow → off restores inert behavior", () => {
  it("shadow then off: counters from shadow remain; off adds nothing; no throw", async () => {
    targetRows.next = {
      id: "tech-blocked",
      role: "technician",
      clinicId: "clinic-1",
      status: "blocked",
      deletedAt: null,
    };

    // Phase 1: shadow run produces a drift counter
    mockResolveMode.mockResolvedValueOnce("shadow");
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "vet", email: "v@e", role: "vet" },
      targetUserId: "tech-blocked",
      transition: "assign",
      taskType: "medication",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetNotActive).toBe(1);

    // Phase 2: rollback to off — same context, no counter movement, no throw
    mockResolveMode.mockResolvedValueOnce("off");
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "vet", email: "v@e", role: "vet" },
        targetUserId: "tech-blocked",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();

    // Counter from the shadow window remains as a historical fact; off adds nothing
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetNotActive).toBe(1);
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.targetNotActive).toBe(0);
  });

  it("rollback per transition — shadow drift seen on each transition, then off zeros further increments", async () => {
    targetRows.next = {
      id: "tech",
      role: "technician",
      clinicId: "OTHER",
      status: "active",
      deletedAt: null,
    };

    // Shadow run × 3 transitions
    for (const transition of ["assign", "reassign", "acknowledge"] as const) {
      mockResolveMode.mockResolvedValueOnce("shadow");
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech", email: "t@e", role: "technician" },
        targetUserId: "tech",
        transition,
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
    }
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetCrossClinic).toBe(3);

    // Rollback to off × 3 transitions
    for (const transition of ["assign", "reassign", "acknowledge"] as const) {
      mockResolveMode.mockResolvedValueOnce("off");
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech", email: "t@e", role: "technician" },
        targetUserId: "tech",
        transition,
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
    }
    // Counter remains at 3; off mode adds no further increments
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetCrossClinic).toBe(3);
  });
});
