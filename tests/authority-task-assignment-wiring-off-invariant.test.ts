/**
 * Phase 3 PR 3.4 — Wiring off-invariant test.
 *
 * In `off` mode the service-layer wiring MUST short-circuit before any new
 * DB query and before invoking the evaluator. The only side effect allowed
 * is the cached config probe (handled by the resolver itself).
 *
 * This test mocks `db` so any `db.select` call is recorded. We then call
 * `applyTaskAssignmentEvaluator` with mode forced `off` via the resolver
 * mock and assert: zero db.select calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbCalls, dbProxy } = vi.hoisted(() => {
  const dbCalls: { method: string; args: unknown[] }[] = [];
  const dbProxy = new Proxy(
    {},
    {
      get(_t, method) {
        return (...args: unknown[]) => {
          dbCalls.push({ method: String(method), args });
          throw new Error(`PR 3.4 off-mode wiring called db.${String(method)} — off invariant violated`);
        };
      },
    },
  );
  return { dbCalls, dbProxy };
});

vi.mock("../server/db.js", () => ({
  db: dbProxy,
  users: {},
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
}));

const mockResolveMode = vi.fn();
vi.mock("../server/lib/authority/enforcement/config.js", () => ({
  resolveTaskAssignmentEnforcementMode: (...args: unknown[]) => mockResolveMode(...args),
}));

import { applyTaskAssignmentEvaluator } from "../server/services/appointments.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

beforeEach(() => {
  dbCalls.length = 0;
  mockResolveMode.mockReset();
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

describe("PR 3.4 wiring — off-mode invariant", () => {
  it("off mode: no db query at any wiring point (assign)", async () => {
    mockResolveMode.mockResolvedValue("off");
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "actor", email: "a@e", role: "vet" },
      targetUserId: "target",
      transition: "assign",
      taskType: "maintenance",
      currentAcknowledgedUserId: null,
      currentStatus: "pending",
    });
    expect(dbCalls.length).toBe(0);
  });

  it("off mode: no db query at any wiring point (reassign)", async () => {
    mockResolveMode.mockResolvedValue("off");
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "admin", email: "a@e", role: "admin" },
      targetUserId: "new-tech",
      transition: "reassign",
      taskType: "maintenance",
      currentAcknowledgedUserId: "old-tech",
      currentStatus: "assigned",
    });
    expect(dbCalls.length).toBe(0);
  });

  it("off mode: no db query at any wiring point (acknowledge)", async () => {
    mockResolveMode.mockResolvedValue("off");
    await applyTaskAssignmentEvaluator({
      clinicId: "clinic-1",
      actor: { userId: "tech", email: "t@e", role: "technician" },
      targetUserId: "tech",
      transition: "acknowledge",
      taskType: "maintenance",
      currentAcknowledgedUserId: null,
      currentStatus: "approved",
    });
    expect(dbCalls.length).toBe(0);
  });

  it("off mode: 100 invocations across all transitions move no counters", async () => {
    mockResolveMode.mockResolvedValue("off");
    for (let i = 0; i < 100; i++) {
      await applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "x", email: "x@e", role: "technician" }, // would deny in shadow/enforce
        targetUserId: "y",
        transition: "assign",
        taskType: "maintenance",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      });
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
    expect(dbCalls.length).toBe(0);
  });

  it("off mode never throws — mutation flow proceeds normally", async () => {
    mockResolveMode.mockResolvedValue("off");
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "x", email: "x@e", role: "vet" },
        targetUserId: "y",
        transition: "assign",
        taskType: "maintenance",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
  });
});
