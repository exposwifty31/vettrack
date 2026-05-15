/**
 * Phase 3 PR 3.4 — Wiring Strategy A invariant test.
 *
 * Strategy A at the wiring layer: any resolver-side failure (the mode
 * resolver itself throws) degrades to off without blocking the mutation.
 * The wiring helper catches the throw and returns. The route handler
 * therefore proceeds with the existing legacy authorization gates
 * unchanged.
 *
 * This is defense-in-depth — the resolver itself catches `getServerConfigValue`
 * throws internally. Reaching the wiring catch requires a pathological
 * cache-side failure, but the invariant must hold.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => {
  const dbTrap = new Proxy(
    {},
    {
      get(_t, p) {
        throw new Error(
          `Strategy A: db.${String(p)} was accessed — the wiring path should not query db when the resolver throws`,
        );
      },
    },
  );
  return {
    db: dbTrap,
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
  resetMetrics();
});

describe("PR 3.4 wiring — Strategy A invariant", () => {
  it("resolver throws → wiring does NOT throw, no db query, no counter movement", async () => {
    mockResolveMode.mockRejectedValue(new Error("resolver pathological failure"));
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

  it("resolver throws across all three transitions → never throws, never queries db", async () => {
    mockResolveMode.mockRejectedValue(new Error("resolver pathological failure"));
    for (const transition of ["assign", "reassign", "acknowledge"] as const) {
      await expect(
        applyTaskAssignmentEvaluator({
          clinicId: "clinic-1",
          actor: { userId: "x", email: "x@e", role: "technician" },
          targetUserId: "y",
          transition,
          taskType: "medication",
          currentAcknowledgedUserId: null,
          currentStatus: "pending",
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("resolver throws then succeeds — recovery on subsequent calls works", async () => {
    mockResolveMode.mockRejectedValueOnce(new Error("transient"));
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "vet-1", email: "v@e", role: "vet" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();

    // On subsequent call: resolver succeeds with off — still no throw, still no db.
    mockResolveMode.mockResolvedValueOnce("off");
    await expect(
      applyTaskAssignmentEvaluator({
        clinicId: "clinic-1",
        actor: { userId: "vet-1", email: "v@e", role: "vet" },
        targetUserId: "tech-2",
        transition: "assign",
        taskType: "medication",
        currentAcknowledgedUserId: null,
        currentStatus: "pending",
      }),
    ).resolves.toBeUndefined();
  });
});
