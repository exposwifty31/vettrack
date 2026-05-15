/**
 * Phase 3 PR 3.4 — Wiring enforce-mode integration test.
 *
 * Drives the wiring helper in enforce mode. Asserts:
 *   - deny verdicts throw AppointmentServiceError with code TASK_ASSIGNMENT_DENIED
 *     and HTTP status 403
 *   - the verdict reason is in details.reason
 *   - allow verdicts do not throw
 *   - the matching `denied` counter increments
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    users: { id: "users.id", role: "users.role", clinicId: "users.clinicId", status: "users.status", deletedAt: "users.deletedAt" },
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

import {
  applyTaskAssignmentEvaluator,
  AppointmentServiceError,
} from "../server/services/appointments.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

beforeEach(() => {
  mockResolveMode.mockReset();
  mockResolveMode.mockResolvedValue("enforce");
  targetRows.next = undefined;
  resetMetrics();
});

describe("PR 3.4 wiring — enforce mode", () => {
  it("technician assigning → throws TASK_ASSIGNMENT_DENIED with reason ACTOR_ROLE_NOT_PERMITTED", async () => {
    targetRows.next = {
      id: "tech-2",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    let thrown: unknown = null;
    try {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-1", email: "t@e", role: "technician" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppointmentServiceError);
    const err = thrown as AppointmentServiceError;
    expect(err.code).toBe("TASK_ASSIGNMENT_DENIED");
    expect(err.status).toBe(403);
    expect(err.details).toEqual({
      reason: "ACTOR_ROLE_NOT_PERMITTED",
      transition: "assign",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.actorRole).toBe(1);
  });

  it("cross-clinic target → throws with reason TARGET_CROSS_CLINIC", async () => {
    targetRows.next = {
      id: "tech-other",
      role: "technician",
      clinicId: "OTHER-CLINIC",
      status: "active",
      deletedAt: null,
    };
    let thrown: unknown = null;
    try {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "admin", email: "a@e", role: "admin" },
        targetUserId: "tech-other",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppointmentServiceError);
    expect((thrown as AppointmentServiceError).details).toEqual({
      reason: "TARGET_CROSS_CLINIC",
      transition: "assign",
    });
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.targetCrossClinic).toBe(1);
  });

  it("acknowledge of task owned by other user → throws OWNERSHIP_EXCLUSIVITY_VIOLATED", async () => {
    targetRows.next = {
      id: "tech-self",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    let thrown: unknown = null;
    try {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-self", email: "t@e", role: "technician" },
        targetUserId: "tech-self",
        transition: "acknowledge",
        taskType: "medication",
        currentAcknowledgedUserId: "other-tech",
        currentStatus: "in_progress",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppointmentServiceError);
    expect((thrown as AppointmentServiceError).details).toEqual({
      reason: "OWNERSHIP_EXCLUSIVITY_VIOLATED",
      transition: "acknowledge",
    });
  });

  it("not-found target → throws TARGET_NOT_ACTIVE via synthetic record", async () => {
    targetRows.next = null;
    let thrown: unknown = null;
    try {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "admin", email: "a@e", role: "admin" },
        targetUserId: "ghost",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppointmentServiceError);
    expect((thrown as AppointmentServiceError).details).toEqual({
      reason: "TARGET_NOT_ACTIVE",
      transition: "assign",
    });
  });

  it("vet assigning to active in-clinic technician → does NOT throw", async () => {
    targetRows.next = {
      id: "tech-1",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "vet-1", email: "v@e", role: "vet" },
        targetUserId: "tech-1",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
  });

  it("vet acknowledging non-medication task: the helper itself WOULD deny (proves the startTask bypass guard is correct)", async () => {
    // This documents the rationale for the canBypassOwnership guard in
    // startTask: if vet/senior_tech are subjected to the evaluator on a
    // non-medication task, the evaluator's target-role check uses
    // canPerformTaskAction(role, "task.start"), which returns false for vet
    // (only technician + admin). This would regress the pre-PR-3.4 path
    // where vet/senior_tech could start non-medication tasks via
    // canBypassOwnership. The startTask wiring therefore exempts bypass
    // roles entirely. This test asserts the regression case the bypass
    // guard prevents.
    targetRows.next = {
      id: "vet-1",
      role: "vet",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    let thrown: unknown = null;
    try {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "vet-1", email: "v@e", role: "vet" },
        targetUserId: "vet-1",
        transition: "acknowledge",
        taskType: "maintenance", // non-medication
        currentAcknowledgedUserId: null,
        currentStatus: "approved",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppointmentServiceError);
    expect((thrown as AppointmentServiceError).details).toEqual({
      reason: "TARGET_ROLE_NOT_PERMITTED",
      transition: "acknowledge",
    });
  });

  it("technician self-acknowledge with no prior owner → allow (sanity)", async () => {
    targetRows.next = {
      id: "tech-self",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-self", email: "t@e", role: "technician" },
        targetUserId: "tech-self",
        transition: "acknowledge",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "approved",
      }),
    ).resolves.toBeUndefined();
  });

  it("reassign-to-current-owner is allow (decision B) — does NOT throw in enforce", async () => {
    targetRows.next = {
      id: "same-tech",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "admin", email: "a@e", role: "admin" },
        targetUserId: "same-tech",
        transition: "reassign",
        taskType: "medication",
        currentAcknowledgedUserId: "same-tech",
        currentStatus: "assigned",
      }),
    ).resolves.toBeUndefined();
  });
});
