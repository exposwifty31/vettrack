/**
 * Phase 5 PR 5.2.1 — orphan-reason coverage hardening (coverage-only).
 *
 * Coverage-only / regression-only per Phase 5 plan §15 PR 5.2.1 + §17
 * forbidden #33 + §19.23 (hardening PRs introduce zero runtime
 * control-flow changes). This file adds NO source edits. It exercises
 * the PR 5.2 evaluator under the full single-line / multi-line matrix
 * of the frozen `OrphanReasonCode` union (plan §19.27) and locks the
 * counter-granularity contract from plan §10.1 / §10.2.
 *
 * Specifically locks:
 *   - All four `OrphanReasonCode` values reachable from BOTH the
 *     shadow path (per-reason `_would_have_blocked_*` increments)
 *     AND the enforce path (deny verdict mirrors `orphanLines`).
 *   - Per-reason counter is a SET counter (one tick per unique
 *     reason in the request), not a BAG counter (one tick per line).
 *   - Mixed-reason single line: every distinct reason on that line
 *     ticks its bucket exactly once.
 *   - Multi-line same-reason: total ticks once; per-reason ticks once.
 *   - Multi-line different-reason: total ticks once; each distinct
 *     reason's bucket ticks once.
 *   - All-four-reasons in one request: total ticks once; each of the
 *     four per-reason buckets ticks once.
 *   - Two sequential requests accumulate additively and independently
 *     (no cross-request state leak).
 *   - Enforce path's deny verdict echoes `orphanLines` byte-identically
 *     and does NOT increment shadow counters (CI-26 / plan §10.1 —
 *     enforce-only counters land in PR 5.7).
 *
 * The wrapped utility `evaluateDispenseAgainstOrders` is mocked at the
 * module boundary so these tests stay pure-function. Real DB
 * interaction is exercised by the existing dispense-route tests.
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

import { evaluateClinicalInvariant } from "../server/lib/authority/enforcement/clinical-invariant.evaluator.js";
import { __resetClinicalInvariantConfigCacheForTests } from "../server/lib/authority/enforcement/clinical-invariant.config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type {
  ClinicalInvariantContext,
  ClinicalInvariantEnforcementMode,
} from "../server/lib/authority/enforcement/clinical-invariant.types.js";
import type { OrphanLineDetail, OrphanReasonCode } from "../server/lib/dispense-order-validation.js";

const FAKE_TX = {} as ClinicalInvariantContext["tx"];

/**
 * The four frozen `OrphanReasonCode` values (plan §19.27).
 * Iterating this list mechanically reaches every reason bucket and
 * surfaces any future widening of the union as a TypeScript error at
 * the per-reason switch in `clinical-invariant.metrics.ts`.
 */
const ALL_REASONS: readonly OrphanReasonCode[] = [
  "NO_PATIENT_LINKED",
  "NO_ACTIVE_HOSPITALIZATION",
  "NO_ACTIVE_ORDER",
  "QUANTITY_EXCEEDS_ORDER",
] as const;

/** Counter snapshot keys aligned with `MetricsSnapshot.clinicalInvariant.shadowWouldHaveBlocked`. */
const REASON_TO_COUNTER_KEY: Record<
  OrphanReasonCode,
  "noPatientLinked" | "noActiveHospitalization" | "noActiveOrder" | "quantityExceedsOrder"
> = {
  NO_PATIENT_LINKED: "noPatientLinked",
  NO_ACTIVE_HOSPITALIZATION: "noActiveHospitalization",
  NO_ACTIVE_ORDER: "noActiveOrder",
  QUANTITY_EXCEEDS_ORDER: "quantityExceedsOrder",
};

function ctx(overrides: Partial<ClinicalInvariantContext> = {}): ClinicalInvariantContext {
  return {
    tx: FAKE_TX,
    clinicId: "clinic-1",
    animalId: "animal-1",
    containerId: "container-1",
    lines: [{ itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" }],
    isEmergency: false,
    bypassReason: null,
    requestId: "req-cov",
    ...overrides,
  };
}

function modeResolver(mode: ClinicalInvariantEnforcementMode) {
  return async () => mode;
}

function orphan(
  itemId: string,
  reasons: readonly OrphanReasonCode[],
  quantity = 1,
): OrphanLineDetail {
  return {
    itemId,
    quantity,
    label: `label-${itemId}`,
    reasons: [...reasons],
    matchingOrderIds: [],
  };
}

function shadowCounters() {
  return getMetricsSnapshot().clinicalInvariant.shadowWouldHaveBlocked;
}

function zeroShadowSnapshot() {
  return {
    total: 0,
    noPatientLinked: 0,
    noActiveHospitalization: 0,
    noActiveOrder: 0,
    quantityExceedsOrder: 0,
  };
}

beforeEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  evaluateDispenseAgainstOrdersMock.mockReset();
});

afterEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow path — each reason exercised in isolation (single-line)
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.2.1 — shadow / single-line / per-reason matrix", () => {
  for (const reason of ALL_REASONS) {
    it(`shadow + single line with reason ${reason}: total=1, ${REASON_TO_COUNTER_KEY[reason]}=1, others=0`, async () => {
      evaluateDispenseAgainstOrdersMock.mockResolvedValue({
        orphanLines: [orphan("item-1", [reason])],
      });

      const verdict = await evaluateClinicalInvariant(ctx(), {
        modeResolver: modeResolver("shadow"),
      });
      // PR 5.5 — the WOULD_HAVE_BLOCKED_SHADOW verdict additionally
      // carries `orphanLines` so the wiring layer can emit the sampled
      // audit post-commit. We only assert the action + disposition
      // discriminator here; PR 5.5's tests cover the orphanLines shape.
      expect(verdict).toMatchObject({ action: "allow", disposition: "WOULD_HAVE_BLOCKED_SHADOW" });

      const expected = zeroShadowSnapshot();
      expected.total = 1;
      expected[REASON_TO_COUNTER_KEY[reason]] = 1;
      expect(shadowCounters()).toEqual(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow path — multi-line same-reason / multi-line different-reason
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.2.1 — shadow / multi-line counter set semantics", () => {
  for (const reason of ALL_REASONS) {
    it(`multi-line same reason ${reason}: per-reason counter ticks ONCE (set semantics, not bag)`, async () => {
      evaluateDispenseAgainstOrdersMock.mockResolvedValue({
        orphanLines: [
          orphan("item-1", [reason]),
          orphan("item-2", [reason]),
          orphan("item-3", [reason]),
        ],
      });

      await evaluateClinicalInvariant(ctx(), { modeResolver: modeResolver("shadow") });

      const snap = shadowCounters();
      expect(snap.total).toBe(1);
      expect(snap[REASON_TO_COUNTER_KEY[reason]]).toBe(1);
      // Every other reason bucket remains 0.
      for (const other of ALL_REASONS) {
        if (other === reason) continue;
        expect(snap[REASON_TO_COUNTER_KEY[other]]).toBe(0);
      }
    });
  }

  it("multi-line different reasons (one per line): each reason bucket ticks once, total ticks once", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [
        orphan("item-1", ["NO_PATIENT_LINKED"]),
        orphan("item-2", ["NO_ACTIVE_HOSPITALIZATION"]),
        orphan("item-3", ["NO_ACTIVE_ORDER"]),
        orphan("item-4", ["QUANTITY_EXCEEDS_ORDER"]),
      ],
    });

    await evaluateClinicalInvariant(ctx(), { modeResolver: modeResolver("shadow") });

    expect(shadowCounters()).toEqual({
      total: 1,
      noPatientLinked: 1,
      noActiveHospitalization: 1,
      noActiveOrder: 1,
      quantityExceedsOrder: 1,
    });
  });

  it("multi-line with overlapping reasons across lines: each distinct reason ticks once", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [
        orphan("item-1", ["NO_ACTIVE_ORDER", "QUANTITY_EXCEEDS_ORDER"]),
        orphan("item-2", ["NO_ACTIVE_ORDER"]),
        orphan("item-3", ["QUANTITY_EXCEEDS_ORDER", "NO_ACTIVE_HOSPITALIZATION"]),
      ],
    });

    await evaluateClinicalInvariant(ctx(), { modeResolver: modeResolver("shadow") });

    expect(shadowCounters()).toEqual({
      total: 1,
      noPatientLinked: 0,
      noActiveHospitalization: 1,
      noActiveOrder: 1, // observed twice across lines but ticks once
      quantityExceedsOrder: 1, // observed twice across lines but ticks once
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow path — single line carrying ALL four reasons
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.2.1 — shadow / all-four-reasons surface", () => {
  it("a single line with all four reasons ticks each bucket exactly once", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", [...ALL_REASONS])],
    });

    await evaluateClinicalInvariant(ctx(), { modeResolver: modeResolver("shadow") });

    expect(shadowCounters()).toEqual({
      total: 1,
      noPatientLinked: 1,
      noActiveHospitalization: 1,
      noActiveOrder: 1,
      quantityExceedsOrder: 1,
    });
  });

  it("four lines each carrying one distinct reason ticks each bucket exactly once", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: ALL_REASONS.map((r, idx) => orphan(`item-${idx}`, [r])),
    });

    await evaluateClinicalInvariant(ctx(), { modeResolver: modeResolver("shadow") });

    expect(shadowCounters()).toEqual({
      total: 1,
      noPatientLinked: 1,
      noActiveHospitalization: 1,
      noActiveOrder: 1,
      quantityExceedsOrder: 1,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shadow path — sequential request isolation (cumulative, independent)
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.2.1 — shadow / sequential request isolation", () => {
  it("two sequential requests accumulate per-reason totals independently and additively", async () => {
    evaluateDispenseAgainstOrdersMock
      .mockResolvedValueOnce({
        orphanLines: [orphan("item-1", ["NO_PATIENT_LINKED", "NO_ACTIVE_ORDER"])],
      })
      .mockResolvedValueOnce({
        orphanLines: [orphan("item-2", ["QUANTITY_EXCEEDS_ORDER"])],
      });

    await evaluateClinicalInvariant(ctx({ requestId: "r1" }), {
      modeResolver: modeResolver("shadow"),
    });
    await evaluateClinicalInvariant(ctx({ requestId: "r2" }), {
      modeResolver: modeResolver("shadow"),
    });

    expect(shadowCounters()).toEqual({
      total: 2,
      noPatientLinked: 1,
      noActiveHospitalization: 0,
      noActiveOrder: 1,
      quantityExceedsOrder: 1,
    });
  });

  it("a clean request between two orphan requests does not perturb the cumulative tally", async () => {
    evaluateDispenseAgainstOrdersMock
      .mockResolvedValueOnce({ orphanLines: [orphan("a", ["NO_ACTIVE_ORDER"])] })
      .mockResolvedValueOnce({ orphanLines: [] }) // clean — no tick
      .mockResolvedValueOnce({ orphanLines: [orphan("b", ["NO_ACTIVE_ORDER"])] });

    for (const requestId of ["r1", "r2", "r3"]) {
      await evaluateClinicalInvariant(ctx({ requestId }), {
        modeResolver: modeResolver("shadow"),
      });
    }

    expect(shadowCounters()).toEqual({
      total: 2,
      noPatientLinked: 0,
      noActiveHospitalization: 0,
      noActiveOrder: 2,
      quantityExceedsOrder: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enforce path — per-reason deny coverage + counter quiescence
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.2.1 — enforce / per-reason deny coverage", () => {
  for (const reason of ALL_REASONS) {
    it(`enforce + single line with reason ${reason}: deny + orphanLines mirror; no shadow counter movement`, async () => {
      const orphans = [orphan("item-1", [reason], 2)];
      evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: orphans });

      const verdict = await evaluateClinicalInvariant(ctx(), {
        modeResolver: modeResolver("enforce"),
      });

      expect(verdict.action).toBe("deny");
      if (verdict.action === "deny") {
        expect(verdict.reason).toBe("ORPHAN_DISPENSE_BLOCKED");
        expect(verdict.orphanLines).toEqual(orphans);
      }

      // PR 5.2 ships no enforce-mode counters; the shadow counters
      // must remain quiescent regardless of which reason fires.
      expect(shadowCounters()).toEqual(zeroShadowSnapshot());
    });
  }

  it("enforce + multi-line mixed reasons: deny + complete orphanLines mirror", async () => {
    const orphans = [
      orphan("item-1", ["NO_PATIENT_LINKED"], 1),
      orphan("item-2", ["NO_ACTIVE_HOSPITALIZATION", "QUANTITY_EXCEEDS_ORDER"], 3),
      orphan("item-3", ["NO_ACTIVE_ORDER"], 5),
    ];
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: orphans });

    const verdict = await evaluateClinicalInvariant(ctx(), {
      modeResolver: modeResolver("enforce"),
    });

    expect(verdict.action).toBe("deny");
    if (verdict.action === "deny") {
      expect(verdict.orphanLines).toEqual(orphans);
      // Quantity values are preserved as-is from the upstream utility.
      expect(verdict.orphanLines.map((l) => l.quantity)).toEqual([1, 3, 5]);
      // Reasons are preserved as-is from the upstream utility.
      expect(verdict.orphanLines.map((l) => l.reasons)).toEqual([
        ["NO_PATIENT_LINKED"],
        ["NO_ACTIVE_HOSPITALIZATION", "QUANTITY_EXCEEDS_ORDER"],
        ["NO_ACTIVE_ORDER"],
      ]);
    }

    expect(shadowCounters()).toEqual(zeroShadowSnapshot());
  });

  it("enforce + clean orphanLines returns plain allow (no deny, no disposition, no counter movement)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });

    const verdict = await evaluateClinicalInvariant(ctx(), {
      modeResolver: modeResolver("enforce"),
    });

    expect(verdict).toEqual({ action: "allow" });
    expect(shadowCounters()).toEqual(zeroShadowSnapshot());
  });
});
