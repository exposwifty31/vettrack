/**
 * Phase 5 PR 5.2 — Clinical-invariant evaluator SHADOW-MODE INVARIANT
 * (Phase 5 plan §4 doctrine 2 + §15 PR 5.2 + §5 CI-25).
 *
 * Proves the following invariants over the shadow path:
 *
 *   1. Shadow NEVER returns `action: "deny"`. No matter what
 *      `evaluateDispenseAgainstOrders` reports, the verdict carries
 *      `action: "allow"`.
 *   2. Shadow ticks `_would_have_blocked*` counters when orphans are
 *      present.
 *   3. Shadow ticks NOTHING when orphans are absent.
 *   4. Shadow does NOT emit any audit row (the audit kind +
 *      emitter land in PR 5.5; PR 5.2 ships no audit emission).
 *   5. Response shape is byte-identical to off-mode at the
 *      `action`/`reason` discriminator level (allow + optional
 *      disposition).
 *   6. Sequential shadow requests accumulate counters monotonically.
 *
 * The wrapped utility `evaluateDispenseAgainstOrders` is mocked so
 * the test stays pure-function. The dedicated audit-emission tests
 * land in PR 5.5 — PR 5.2 cannot assert "audit emitted" because the
 * emitter does not exist yet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  appointments: {},
  hospitalizations: {},
  inventoryItems: {},
}));

const evaluateDispenseAgainstOrdersMock = vi.fn();
vi.mock("../server/lib/dispense-order-validation.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/dispense-order-validation.js")>(
    "../server/lib/dispense-order-validation.js",
  );
  return {
    ...actual,
    evaluateDispenseAgainstOrders: (...args: unknown[]) =>
      evaluateDispenseAgainstOrdersMock(...args),
  };
});

vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: vi.fn().mockResolvedValue(null),
}));

// Lock the audit module so any unexpected logAudit call would be
// observable. PR 5.2 ships no audit emission for the clinical-
// invariant family; if a future change accidentally adds one here,
// the lock-test below will catch it.
const logAuditMock = vi.fn();
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return {
    ...actual,
    logAudit: (...args: unknown[]) => logAuditMock(...args),
  };
});

import { evaluateClinicalInvariant } from "../server/lib/authority/enforcement/clinical-invariant.evaluator.js";
import { __resetClinicalInvariantConfigCacheForTests } from "../server/lib/authority/enforcement/clinical-invariant.config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type { ClinicalInvariantContext } from "../server/lib/authority/enforcement/clinical-invariant.types.js";
import type { OrphanLineDetail } from "../server/lib/dispense-order-validation.js";

const FAKE_TX = {} as ClinicalInvariantContext["tx"];

function baseContext(overrides: Partial<ClinicalInvariantContext> = {}): ClinicalInvariantContext {
  return {
    tx: FAKE_TX,
    clinicId: "clinic-1",
    animalId: "animal-1",
    containerId: "container-1",
    lines: [{ itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" }],
    isEmergency: false,
    bypassReason: null,
    requestId: "req-1",
    ...overrides,
  };
}

function orphan(itemId: string, reasons: OrphanLineDetail["reasons"]): OrphanLineDetail {
  return { itemId, quantity: 1, label: `label-${itemId}`, reasons, matchingOrderIds: [] };
}

beforeEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  evaluateDispenseAgainstOrdersMock.mockReset();
  logAuditMock.mockReset();
});

afterEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
});

describe("clinical-invariant evaluator — shadow-mode invariant", () => {
  it("shadow + clean orphanLines: returns plain allow (no disposition); no counter movement", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: async () => "shadow",
    });
    expect(verdict).toEqual({ action: "allow" });

    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(0);
  });

  it("shadow + orphans: NEVER returns action: deny", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: async () => "shadow",
    });
    expect(verdict.action).toBe("allow");
    if (verdict.action === "allow") {
      expect(verdict.disposition).toBe("WOULD_HAVE_BLOCKED_SHADOW");
    }
  });

  it("shadow + orphans: ticks _would_have_blocked total + per-reason counter", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_HOSPITALIZATION"])],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: async () => "shadow" });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(1);
    expect(snap.shadowWouldHaveBlocked.noActiveHospitalization).toBe(1);
  });

  it("shadow emits NO audit row in PR 5.2 (audit kind + emitter land in PR 5.5)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: async () => "shadow" });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("shadow with 100 sequential orphan-detection requests accumulates monotonically", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    for (let i = 0; i < 100; i++) {
      const verdict = await evaluateClinicalInvariant(baseContext(), {
        modeResolver: async () => "shadow",
      });
      expect(verdict.action).toBe("allow");
    }
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(100);
    expect(snap.shadowWouldHaveBlocked.noActiveOrder).toBe(100);
  });

  it("shadow response shape matches off-mode shape at the discriminator level", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const shadowVerdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: async () => "shadow",
    });
    const offVerdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: async () => "off",
    });
    expect(shadowVerdict.action).toBe(offVerdict.action);
    expect(shadowVerdict.action).toBe("allow");
  });

  it("shadow does NOT increment enforce-mode resolved counters (resolved-mode counters tick at the wiring site, not in the evaluator)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: async () => "shadow" });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.resolved).toEqual({ off: 0, shadow: 0, enforce: 0 });
  });
});
