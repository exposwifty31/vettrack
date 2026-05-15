/**
 * Phase 3 PR 3.6 — Stale-task-ownership evaluator unit tests.
 *
 * Pure-function tests over (mode, context). Mode resolver is injected; the
 * env-backed resolver is not exercised.
 *
 * Tests prove:
 *   - off mode: always allow, no field inspected beyond clinicId+mode
 *   - shadow mode: never returns would_revoke; would-have-revoked counter
 *     increments only when ownership is actually stale
 *   - enforce mode: returns would_revoke for stale rows; PR 3.6 ships the
 *     verdict shape but NO CONSUMER acts on it (the tombstone `revoked`
 *     counter must remain 0)
 *   - active-treatment safety floor: HARD invariant; ALL modes (including
 *     enforce) return allow for active-treatment tasks
 *   - emergency-suspend bypass
 *   - degraded-mode pause
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  appointments: {},
  clinicalCheckIns: {},
  auditLogs: {},
  eventOutbox: {},
}));

import {
  classifyStaleTaskOwnership,
  evaluateStaleTaskOwnership,
} from "../server/lib/authority/enforcement/stale-task-ownership.evaluator.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type {
  StaleTaskOwnershipContext,
  StaleTaskOwnershipEnforcementMode,
} from "../server/lib/authority/enforcement/stale-task-ownership.types.js";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");
const ONE_MINUTE = 60_000;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;

function baseContext(overrides: Partial<StaleTaskOwnershipContext> = {}): StaleTaskOwnershipContext {
  return {
    clinicId: "clinic-1",
    now: FIXED_NOW,
    graceWindowMs: FIFTEEN_MINUTES,
    activityWindowMs: FIVE_MINUTES,
    emergencySuspend: false,
    resolverOperational: true,
    task: {
      id: "task-1",
      acknowledgedUserId: "tech-1",
      acknowledgedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR),
      status: "in_progress",
      updatedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR), // not active treatment
    },
    ownerCheckInEndedAt: new Date(FIXED_NOW.getTime() - ONE_HOUR), // ended 1h ago (past grace)
    ...overrides,
  };
}

function modeResolver(mode: StaleTaskOwnershipEnforcementMode) {
  return async () => mode;
}

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyStaleTaskOwnership — pure helper

describe("classifyStaleTaskOwnership — pure classification", () => {
  it("stale: owner checked out > grace, task not in active-treatment window, status active", () => {
    expect(classifyStaleTaskOwnership(baseContext())).toBe("stale");
  });

  it("not stale: owner currently checked in (null ended)", () => {
    expect(
      classifyStaleTaskOwnership(baseContext({ ownerCheckInEndedAt: null })),
    ).toBe("not_stale");
  });

  it("not stale: owner checked out but within grace window", () => {
    expect(
      classifyStaleTaskOwnership(
        baseContext({ ownerCheckInEndedAt: new Date(FIXED_NOW.getTime() - 5 * ONE_MINUTE) }),
      ),
    ).toBe("not_stale");
  });

  it("active_treatment_protected: task updatedAt within activity window (HARD invariant)", () => {
    expect(
      classifyStaleTaskOwnership(
        baseContext({
          task: {
            ...baseContext().task,
            updatedAt: new Date(FIXED_NOW.getTime() - 2 * ONE_MINUTE),
          },
        }),
      ),
    ).toBe("active_treatment_protected");
  });

  it("not_in_active_status: terminal statuses are not stale candidates", () => {
    for (const status of ["completed", "cancelled", "no_show"]) {
      expect(
        classifyStaleTaskOwnership(
          baseContext({ task: { ...baseContext().task, status } }),
        ),
        `status=${status}`,
      ).toBe("not_in_active_status");
    }
  });

  it("active_treatment_protected SUPERSEDES the stale determination", () => {
    // Even with all stale conditions otherwise satisfied, active-treatment
    // wins. This is the HARD invariant of §11.4.
    expect(
      classifyStaleTaskOwnership(
        baseContext({
          ownerCheckInEndedAt: new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
          task: {
            ...baseContext().task,
            updatedAt: new Date(FIXED_NOW.getTime() - 30_000), // 30s ago → active
          },
        }),
      ),
    ).toBe("active_treatment_protected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// off mode

describe("evaluateStaleTaskOwnership — off mode", () => {
  it("off returns allow with protected=OFF", async () => {
    const result = await evaluateStaleTaskOwnership(baseContext(), {
      modeResolver: modeResolver("off"),
    });
    expect(result).toEqual({ action: "allow", protected: "OFF" });
  });

  it("off NEVER moves any counter, even on a stale row", async () => {
    await evaluateStaleTaskOwnership(baseContext(), { modeResolver: modeResolver("off") });
    const snap = getMetricsSnapshot().staleTaskOwnership;
    expect(snap.scanned).toBe(0);
    expect(snap.wouldHaveRevoked).toBe(0);
    expect(snap.activeTreatmentProtected).toBe(0);
    expect(snap.emergencySuspendSkip).toBe(0);
    expect(snap.degradedModePause).toBe(0);
    expect(snap.revoked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shadow mode

describe("evaluateStaleTaskOwnership — shadow mode", () => {
  it("shadow with stale row → allow + would-have-revoked counter increments", async () => {
    const result = await evaluateStaleTaskOwnership(baseContext(), {
      modeResolver: modeResolver("shadow"),
    });
    expect(result.action).toBe("allow");
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(1);
    // Tombstone never moves.
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });

  it("shadow with non-stale row → allow, no counter", async () => {
    await evaluateStaleTaskOwnership(
      baseContext({ ownerCheckInEndedAt: null }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enforce mode — verdict shape exists; tombstone NEVER moves

describe("evaluateStaleTaskOwnership — enforce mode (verdict shape only)", () => {
  it("enforce with stale row → would_revoke verdict; tombstone revoked counter stays 0", async () => {
    const result = await evaluateStaleTaskOwnership(baseContext(), {
      modeResolver: modeResolver("enforce"),
    });
    expect(result).toEqual({ action: "would_revoke", reason: "STALE_OWNERSHIP" });
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(1);
    // PR 3.6 INVARIANT: no consumer in PR 3.6 ever increments `revoked`.
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });

  it("enforce with non-stale row → allow", async () => {
    const result = await evaluateStaleTaskOwnership(
      baseContext({ ownerCheckInEndedAt: null }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(result.action).toBe("allow");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active-treatment safety floor — HARD invariant

describe("evaluateStaleTaskOwnership — active-treatment safety floor (HARD)", () => {
  for (const mode of ["shadow", "enforce"] as const) {
    it(`${mode}: active-treatment task NEVER returns would_revoke (HARD §11.4)`, async () => {
      const result = await evaluateStaleTaskOwnership(
        baseContext({
          ownerCheckInEndedAt: new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
          task: {
            ...baseContext().task,
            updatedAt: new Date(FIXED_NOW.getTime() - 30_000), // 30s — active
          },
        }),
        { modeResolver: modeResolver(mode) },
      );
      expect(result).toEqual({ action: "allow", protected: "ACTIVE_TREATMENT" });
      expect(getMetricsSnapshot().staleTaskOwnership.activeTreatmentProtected).toBe(1);
      expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(0);
      expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
    });
  }

  it("100 active-treatment evaluations across modes leave the revoked tombstone at 0", async () => {
    for (let i = 0; i < 50; i++) {
      await evaluateStaleTaskOwnership(
        baseContext({
          ownerCheckInEndedAt: new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
          task: { ...baseContext().task, updatedAt: new Date(FIXED_NOW.getTime() - 60_000) },
        }),
        { modeResolver: modeResolver("shadow") },
      );
      await evaluateStaleTaskOwnership(
        baseContext({
          ownerCheckInEndedAt: new Date(FIXED_NOW.getTime() - 24 * ONE_HOUR),
          task: { ...baseContext().task, updatedAt: new Date(FIXED_NOW.getTime() - 60_000) },
        }),
        { modeResolver: modeResolver("enforce") },
      );
    }
    expect(getMetricsSnapshot().staleTaskOwnership.revoked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Emergency suspend + degraded mode

describe("evaluateStaleTaskOwnership — emergency suspend", () => {
  it("emergency suspend in shadow → allow + emergencySuspendSkip counter; no wouldHaveRevoked", async () => {
    const result = await evaluateStaleTaskOwnership(
      baseContext({ emergencySuspend: true }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(result).toEqual({ action: "allow", protected: "EMERGENCY_SUSPEND" });
    expect(getMetricsSnapshot().staleTaskOwnership.emergencySuspendSkip).toBe(1);
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(0);
  });

  it("emergency suspend in enforce → allow + emergencySuspendSkip counter; no would_revoke", async () => {
    const result = await evaluateStaleTaskOwnership(
      baseContext({ emergencySuspend: true }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(result).toEqual({ action: "allow", protected: "EMERGENCY_SUSPEND" });
    expect(getMetricsSnapshot().staleTaskOwnership.emergencySuspendSkip).toBe(1);
  });
});

describe("evaluateStaleTaskOwnership — degraded mode", () => {
  it("degraded resolver in shadow → allow + degradedModePause; no wouldHaveRevoked", async () => {
    const result = await evaluateStaleTaskOwnership(
      baseContext({ resolverOperational: false }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(result).toEqual({ action: "allow", protected: "DEGRADED_MODE" });
    expect(getMetricsSnapshot().staleTaskOwnership.degradedModePause).toBe(1);
    expect(getMetricsSnapshot().staleTaskOwnership.wouldHaveRevoked).toBe(0);
  });

  it("degraded resolver in enforce → allow + degradedModePause; no would_revoke", async () => {
    const result = await evaluateStaleTaskOwnership(
      baseContext({ resolverOperational: false }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(result.action).toBe("allow");
    expect(getMetricsSnapshot().staleTaskOwnership.degradedModePause).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Isolation: PR 3.6 has zero touch on PR 3.3 task-assignment counters

describe("evaluateStaleTaskOwnership — observability isolation", () => {
  it("evaluator invocation does NOT move ANY task-assignment counter", async () => {
    for (let i = 0; i < 30; i++) {
      await evaluateStaleTaskOwnership(baseContext(), { modeResolver: modeResolver("enforce") });
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
