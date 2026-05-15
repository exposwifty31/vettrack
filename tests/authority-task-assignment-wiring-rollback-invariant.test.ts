/**
 * Phase 3 PR 3.4 — Wiring rollback invariant test.
 *
 * Flipping `enforce → off` at the wiring level must restore byte-identical
 * inert behavior: subsequent invocations must not throw, must not query the
 * db, and must not move counters. Counters from the enforce window remain
 * as historical facts and do not regress.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { targetRows } = vi.hoisted(() => {
  const targetRows: Record<string, unknown> = {};
  return { targetRows };
});

let dbCallCount = 0;

vi.mock("../server/db.js", () => {
  const db = {
    select: (_cols: unknown) => {
      dbCallCount += 1;
      return {
        from: (_table: unknown) => ({
          where: (_clause: unknown) => ({
            limit: async (_n: number) => {
              const next = targetRows.next ?? null;
              return next ? [next] : [];
            },
          }),
        }),
      };
    },
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
  targetRows.next = undefined;
  dbCallCount = 0;
  resetMetrics();
});

describe("PR 3.4 wiring — rollback invariant", () => {
  it("enforce → off: first enforce throws, then off allows + no db query", async () => {
    targetRows.next = {
      id: "tech-2",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };

    // Phase 1: enforce produces a denial + counter increment.
    mockResolveMode.mockResolvedValueOnce("enforce");
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
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.actorRole).toBe(1);
    const dbCallsAfterEnforce = dbCallCount;

    // Phase 2: rollback flip — same context, mode forced 'off'. No throw,
    // no new db query, no counter movement.
    mockResolveMode.mockResolvedValueOnce("off");
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-1", email: "t@e", role: "technician" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();

    // Off-mode invariant: no new db query after the rollback.
    expect(dbCallCount).toBe(dbCallsAfterEnforce);
    // Counters from the enforce window remain historical facts; off mode
    // adds nothing on top.
    expect(getMetricsSnapshot().taskAssignmentEnforce.denied.actorRole).toBe(1);
  });

  it("shadow → off: counter from shadow remains, off adds nothing", async () => {
    targetRows.next = {
      id: "tech-2",
      role: "technician",
      clinicId: "clinic-1",
      status: "active",
      deletedAt: null,
    };

    mockResolveMode.mockResolvedValueOnce("shadow");
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

    // Rollback to off.
    mockResolveMode.mockResolvedValueOnce("off");
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-1", email: "t@e", role: "technician" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();

    // Counters do not regress (shadow increment stays); no new increment from off.
    expect(getMetricsSnapshot().taskAssignmentEnforce.wouldHaveDenied.actorRole).toBe(1);
  });

  it("repeated off invocations after rollback are zero-cost on db", async () => {
    mockResolveMode.mockResolvedValue("off");
    const before = dbCallCount;
    for (let i = 0; i < 25; i++) {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "tech-1", email: "t@e", role: "technician" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
    }
    expect(dbCallCount).toBe(before);
  });
});
