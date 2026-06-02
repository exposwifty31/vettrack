/**
 * Phase 3 PR 3.4 — Wiring shadow-mode integration test.
 *
 * Drives the wiring helper in shadow mode across all three transitions.
 * Asserts:
 *   - mutation never throws (verdict is always allow in shadow)
 *   - per-reason counters increment when the evaluator would have denied
 *   - the matching `denied` counter does NOT move (shadow only)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hydrated target user mock — vi.hoisted runs before vi.mock factories.
const { targetRows } = vi.hoisted(() => {
  const targetRows: Record<string, {
    id: string;
    role: string;
    clinicId: string;
    status: string;
    deletedAt: Date | null;
  } | null> = {};
  return { targetRows };
});

vi.mock("../server/db.js", () => {
  const db = {
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_clause: unknown) => ({
          limit: async (_n: number) => {
            // Decode the where clause is too complex with eq; instead the
            // test sets `targetRows.next` and the mock returns it.
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

import { applyTaskAssignmentEvaluator } from "../server/services/appointments.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

beforeEach(() => {
  mockResolveMode.mockReset();
  mockResolveMode.mockResolvedValue("shadow");
  delete (targetRows as Record<string, unknown>).next;
  resetMetrics();
});

describe("PR 3.4 wiring — shadow mode", () => {
  it("assign with active in-clinic tech target → allow, no counter movement", async () => {
    (targetRows as Record<string, unknown>).next = {
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
        taskType: "maintenance",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
    const snap = getMetricsSnapshot().taskAssignmentEnforce;
    expect(snap.wouldHaveDenied.actorRole).toBe(0);
    expect(snap.denied.actorRole).toBe(0);
  });

  it("assign by technician → allow + actorRole would-have-denied counter increments", async () => {
    (targetRows as Record<string, unknown>).next = {
      id: "tech-2",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-1", email: "t@e", role: "technician" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "maintenance",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
    const snap = getMetricsSnapshot().taskAssignmentEnforce;
    expect(snap.wouldHaveDenied.actorRole).toBe(1);
    expect(snap.denied.actorRole).toBe(0);
  });

  it("reassign to cross-clinic target → allow + targetCrossClinic would-have-denied", async () => {
    (targetRows as Record<string, unknown>).next = {
      id: "tech-other",
      role: "technician",
      clinicId: "OTHER-CLINIC",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "admin", email: "a@e", role: "admin" },
        targetUserId: "tech-other",
        transition: "reassign",
        taskType: "maintenance",
        currentAcknowledgedUserId: "old-tech",
        currentStatus: "assigned",
      }),
    ).resolves.toBeUndefined();
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetCrossClinic).toBe(1);
  });

  it("acknowledge by other-than-target → allow + actorRole would-have-denied", async () => {
    (targetRows as Record<string, unknown>).next = {
      id: "admin",
      role: "admin",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "admin", email: "a@e", role: "admin" },
        targetUserId: "admin",
        transition: "acknowledge",
        taskType: "maintenance",
        currentAcknowledgedUserId: "other-tech",
        currentStatus: "in_progress",
      }),
    ).resolves.toBeUndefined();
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.exclusivity).toBe(1);
  });

  it("not-found target → synthetic record → TARGET_NOT_ACTIVE would-have-denied", async () => {
    (targetRows as Record<string, unknown>).next = null;
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "admin", email: "a@e", role: "admin" },
        targetUserId: "ghost",
        transition: "assign",
        taskType: "maintenance",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.targetNotActive).toBe(1);
  });

  it("shadow returns no thrown error across all three transitions in sequence", async () => {
    (targetRows as Record<string, unknown>).next = {
      id: "tech-3",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };
    for (const transition of ["assign", "reassign", "acknowledge"] as const) {
      await expect(
        applyTaskAssignmentEvaluator({
          clinicId: "clinic-1",
          actor: { userId: "tech-3", email: "t@e", role: "technician" },
          targetUserId: "tech-3",
          transition,
          taskType: "maintenance",
          currentAcknowledgedUserId: null,
          currentStatus: "pending",
        }),
      ).resolves.toBeUndefined();
    }
  });
});
