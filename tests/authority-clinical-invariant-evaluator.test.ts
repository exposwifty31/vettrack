/**
 * Phase 5 PR 5.2 — Clinical-invariant evaluator unit tests.
 *
 * Pure-function tests over (mode, context). Mode resolver is injected;
 * the env-backed resolver is exercised via the dedicated config test
 * file from PR 5.1 (`tests/authority-clinical-invariant-config.test.ts`).
 *
 * Coverage:
 *   - off mode: always allow + disposition OFF; no DB read; no counter
 *     movement (the dedicated off-invariant file proves zero queries
 *     with a query-spy).
 *   - emergency carve-out (CI-7): allow + disposition EMERGENCY_BYPASS;
 *     no DB read; counters unchanged.
 *   - clean shadow / clean enforce: allow (no disposition); orphan
 *     counters at 0.
 *   - shadow with orphans: allow + disposition WOULD_HAVE_BLOCKED_SHADOW;
 *     `_would_have_blocked` += 1; per-reason counters tick once per
 *     unique reason in the request.
 *   - enforce with orphans: deny + reason ORPHAN_DISPENSE_BLOCKED +
 *     orphanLines mirror.
 *   - injected modeResolver wins over the config resolver.
 *
 * The wrapped utility `evaluateDispenseAgainstOrders` is mocked at
 * the module boundary so these tests stay pure-function. Real DB
 * interaction is exercised by the dispense-route tests that already
 * cover `evaluateDispenseAgainstOrders` directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Database module must be neutered for unit-test loading. The
// evaluator never touches `db` directly (it uses the caller-provided
// `tx`), but `dispense-order-validation.js` imports table objects.
vi.mock("../server/db.js", () => ({
  db: {},
  appointments: {},
  hospitalizations: {},
  inventoryItems: {},
}));

// Stub the pure validation utility. We're testing the evaluator's
// dispatch logic, not the underlying SQL.
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

// Force the production config resolver to return "off" so an
// accidental fall-through (no injected modeResolver, missing env)
// resolves deterministically in tests.
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: vi.fn().mockResolvedValue(null),
}));

import { evaluateClinicalInvariant } from "../server/lib/authority/enforcement/clinical-invariant.evaluator.js";
import { __resetClinicalInvariantConfigCacheForTests } from "../server/lib/authority/enforcement/clinical-invariant.config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type {
  ClinicalInvariantContext,
  ClinicalInvariantEnforcementMode,
} from "../server/lib/authority/enforcement/clinical-invariant.types.js";
import type { OrphanLineDetail } from "../server/lib/dispense-order-validation.js";

const FAKE_TX = {} as ClinicalInvariantContext["tx"];

function baseContext(overrides: Partial<ClinicalInvariantContext> = {}): ClinicalInvariantContext {
  return {
    tx: FAKE_TX,
    clinicId: "clinic-1",
    animalId: "animal-1",
    containerId: "container-1",
    lines: [
      { itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" },
    ],
    isEmergency: false,
    bypassReason: null,
    requestId: "req-1",
    ...overrides,
  };
}

function modeResolver(mode: ClinicalInvariantEnforcementMode) {
  return async () => mode;
}

function orphanLine(
  itemId: string,
  reasons: OrphanLineDetail["reasons"],
  quantity = 1,
): OrphanLineDetail {
  return {
    itemId,
    quantity,
    label: `label-${itemId}`,
    reasons,
    matchingOrderIds: [],
  };
}

beforeEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  evaluateDispenseAgainstOrdersMock.mockReset();
  delete process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
});

afterEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  delete process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
});

// ─────────────────────────────────────────────────────────────────────────────
// Off mode
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — off mode (CI-27)", () => {
  it("returns allow + disposition OFF without invoking evaluateDispenseAgainstOrders", async () => {
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: modeResolver("off"),
    });
    expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
    expect(evaluateDispenseAgainstOrdersMock).not.toHaveBeenCalled();
  });

  it("does not move any counter in off mode", async () => {
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("off") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked).toEqual({
      total: 0,
      noPatientLinked: 0,
      noActiveHospitalization: 0,
      noActiveOrder: 0,
      quantityExceedsOrder: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Emergency carve-out (CI-7)
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — emergency carve-out (CI-7)", () => {
  it("short-circuits before DB read in shadow mode", async () => {
    const verdict = await evaluateClinicalInvariant(
      baseContext({ isEmergency: true, bypassReason: "EMERGENCY_CPR" }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({ action: "allow", disposition: "EMERGENCY_BYPASS" });
    expect(evaluateDispenseAgainstOrdersMock).not.toHaveBeenCalled();
  });

  it("short-circuits before DB read in enforce mode", async () => {
    const verdict = await evaluateClinicalInvariant(
      baseContext({ isEmergency: true, bypassReason: "EMERGENCY_CPR" }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({ action: "allow", disposition: "EMERGENCY_BYPASS" });
    expect(evaluateDispenseAgainstOrdersMock).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit when isEmergency is true but bypassReason is empty", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const verdict = await evaluateClinicalInvariant(
      baseContext({ isEmergency: true, bypassReason: "" }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({ action: "allow" });
    expect(evaluateDispenseAgainstOrdersMock).toHaveBeenCalledOnce();
  });

  it("does NOT short-circuit when isEmergency is false even with bypassReason set", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const verdict = await evaluateClinicalInvariant(
      baseContext({ isEmergency: false, bypassReason: "STALE_TOKEN" }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({ action: "allow" });
    expect(evaluateDispenseAgainstOrdersMock).toHaveBeenCalledOnce();
  });

  it("emergency carve-out does not move any counter", async () => {
    await evaluateClinicalInvariant(
      baseContext({ isEmergency: true, bypassReason: "EMERGENCY_CPR" }),
      { modeResolver: modeResolver("shadow") },
    );
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clean paths (no orphans detected)
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — clean shadow / enforce paths", () => {
  it("shadow + no orphans returns plain allow", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: modeResolver("shadow"),
    });
    expect(verdict).toEqual({ action: "allow" });
  });

  it("enforce + no orphans returns plain allow", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: modeResolver("enforce"),
    });
    expect(verdict).toEqual({ action: "allow" });
  });

  it("clean shadow does not move any counter", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow with orphans — counter semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — shadow + orphans", () => {
  it("returns allow + disposition WOULD_HAVE_BLOCKED_SHADOW", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphanLine("item-1", ["NO_ACTIVE_ORDER"])],
    });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: modeResolver("shadow"),
    });
    expect(verdict).toEqual({ action: "allow", disposition: "WOULD_HAVE_BLOCKED_SHADOW" });
  });

  it("ticks `_would_have_blocked` total once per request regardless of line count", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [
        orphanLine("item-1", ["NO_ACTIVE_ORDER"]),
        orphanLine("item-2", ["NO_ACTIVE_ORDER"]),
        orphanLine("item-3", ["NO_ACTIVE_ORDER"]),
      ],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(1);
    expect(snap.shadowWouldHaveBlocked.noActiveOrder).toBe(1);
  });

  it("per-reason counter ticks once per UNIQUE reason in the request", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [
        orphanLine("item-1", ["NO_PATIENT_LINKED", "NO_ACTIVE_ORDER"]),
        orphanLine("item-2", ["NO_ACTIVE_ORDER", "QUANTITY_EXCEEDS_ORDER"]),
      ],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(1);
    expect(snap.shadowWouldHaveBlocked.noPatientLinked).toBe(1);
    expect(snap.shadowWouldHaveBlocked.noActiveOrder).toBe(1); // not 2
    expect(snap.shadowWouldHaveBlocked.quantityExceedsOrder).toBe(1);
    expect(snap.shadowWouldHaveBlocked.noActiveHospitalization).toBe(0);
  });

  it("all four OrphanReasonCode buckets are reachable", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [
        orphanLine("item-1", [
          "NO_PATIENT_LINKED",
          "NO_ACTIVE_HOSPITALIZATION",
          "NO_ACTIVE_ORDER",
          "QUANTITY_EXCEEDS_ORDER",
        ]),
      ],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked).toEqual({
      total: 1,
      noPatientLinked: 1,
      noActiveHospitalization: 1,
      noActiveOrder: 1,
      quantityExceedsOrder: 1,
    });
  });

  it("two separate shadow requests accumulate independently", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphanLine("item-1", ["NO_ACTIVE_ORDER"])],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(2);
    expect(snap.shadowWouldHaveBlocked.noActiveOrder).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enforce with orphans — deny verdict
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — enforce + orphans", () => {
  it("returns deny with reason ORPHAN_DISPENSE_BLOCKED + orphanLines mirror", async () => {
    const orphans = [orphanLine("item-1", ["NO_ACTIVE_ORDER"], 3)];
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: orphans });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: modeResolver("enforce"),
    });
    expect(verdict.action).toBe("deny");
    if (verdict.action === "deny") {
      expect(verdict.reason).toBe("ORPHAN_DISPENSE_BLOCKED");
      expect(verdict.orphanLines).toEqual(orphans);
    }
  });

  it("does NOT increment shadow counters in enforce mode (PR 5.2 ships no enforce counters)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphanLine("item-1", ["NO_ACTIVE_ORDER"])],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("enforce") });
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.shadowWouldHaveBlocked.total).toBe(0);
    expect(snap.shadowWouldHaveBlocked.noActiveOrder).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode resolver injection — wins over the config resolver
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — modeResolver injection", () => {
  it("injected resolver overrides the env-backed config resolver", async () => {
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "enforce";
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
    const verdict = await evaluateClinicalInvariant(baseContext(), {
      modeResolver: modeResolver("off"),
    });
    expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
  });

  it("without injection, falls back to the env-backed config resolver", async () => {
    // No env var set → resolver resolves to "off" → short-circuit.
    const verdict = await evaluateClinicalInvariant(baseContext());
    expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
    expect(evaluateDispenseAgainstOrdersMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error propagation — wiring layer owns runtime control flow (CI-20)
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateClinicalInvariant — error propagation (CI-20)", () => {
  it("propagates evaluateDispenseAgainstOrders throws — wiring layer owns catch", async () => {
    evaluateDispenseAgainstOrdersMock.mockRejectedValue(new Error("db lock"));
    await expect(
      evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("shadow") }),
    ).rejects.toThrow("db lock");
  });

  it("invokes evaluateDispenseAgainstOrders exactly once per call (CI-16)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphanLine("item-1", ["NO_ACTIVE_ORDER"])],
    });
    await evaluateClinicalInvariant(baseContext(), { modeResolver: modeResolver("enforce") });
    expect(evaluateDispenseAgainstOrdersMock).toHaveBeenCalledOnce();
  });
});
