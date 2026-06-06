/**
 * Phase 5 PR 5.5 — shadow observability validation.
 *
 * PR 5.5 ships:
 *   1. `clinical_invariant_shadow_would_have_blocked` AuditActionType
 *      literal.
 *   2. `emitClinicalInvariantShadowWouldHaveBlockedAudit` emitter
 *      (gated by `AUTHORITY_OBS_V1`, sampled 1 per 5 min per
 *      `(clinicId, animalId)`, best-effort per CI-25).
 *   3. The evaluator returns `orphanLines` on the
 *      `WOULD_HAVE_BLOCKED_SHADOW` allow verdict — the wiring layer
 *      (PR 5.3 `dispense.service.ts` + PR 5.4 `containers.ts` route)
 *      emits the audit POST-COMMIT (never inside the tx) to avoid
 *      false-positive observability rows when a downstream throw
 *      rolls the request back (Codex P2 review on the original
 *      PR 5.5 attempt).
 *
 * This file's tests cover (1), (2), and (3a) — the evaluator's
 * verdict-side contract and the emitter's standalone behaviour. The
 * wiring-side post-commit emission is covered by the integration
 * test in `tests/phase-5-pr-5-3-dispense-confirm-wiring.test.ts`
 * and the addition asserted below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  appointments: {},
  hospitalizations: {},
  inventoryItems: {},
  auditLogs: {},
  eventOutbox: {},
}));

const evaluateDispenseAgainstOrdersMock = vi.fn();
vi.mock("../server/lib/dispense-order-validation.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/dispense-order-validation.js")
  >("../server/lib/dispense-order-validation.js");
  return {
    ...actual,
    evaluateDispenseAgainstOrders: (...args: unknown[]) =>
      evaluateDispenseAgainstOrdersMock(...args),
  };
});

vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: vi.fn().mockResolvedValue(null),
}));

const logAuditMock = vi.fn();
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return { ...actual, logAudit: (...args: unknown[]) => logAuditMock(...args) };
});

import { evaluateClinicalInvariant } from "../server/lib/authority/enforcement/clinical-invariant.evaluator.js";
import { __resetClinicalInvariantConfigCacheForTests } from "../server/lib/authority/enforcement/clinical-invariant.config.js";
import { emitClinicalInvariantShadowWouldHaveBlockedAudit } from "../server/lib/authority/enforcement/clinical-invariant.audit.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type { ClinicalInvariantContext } from "../server/lib/authority/enforcement/clinical-invariant.types.js";
import type { OrphanLineDetail } from "../server/lib/dispense-order-validation.js";

const FAKE_TX = {} as ClinicalInvariantContext["tx"];

function ctx(overrides: Partial<ClinicalInvariantContext> = {}): ClinicalInvariantContext {
  return {
    tx: FAKE_TX,
    clinicId: "clinic-1",
    animalId: "animal-1",
    containerId: "container-1",
    lines: [{ itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" }],
    isEmergency: false,
    bypassReason: null,
    requestId: "req-pr-5-5",
    ...overrides,
  };
}

function orphan(itemId: string, reasons: OrphanLineDetail["reasons"]): OrphanLineDetail {
  return { itemId, quantity: 1, label: `label-${itemId}`, reasons, matchingOrderIds: [] };
}

function shadowAuditCalls() {
  return logAuditMock.mock.calls.filter(
    ([params]) =>
      params != null &&
      typeof params === "object" &&
      (params as { actionType?: unknown }).actionType ===
        "clinical_invariant_shadow_would_have_blocked",
  );
}

beforeEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  evaluateDispenseAgainstOrdersMock.mockReset();
  logAuditMock.mockReset();
  process.env.AUTHORITY_OBS_V1 = "true";
});

afterEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  delete process.env.AUTHORITY_OBS_V1;
});

// ─── Evaluator verdict surface (PR 5.5 contract change) ────────────────────

describe("PR 5.5 — evaluator returns orphanLines on the WOULD_HAVE_BLOCKED_SHADOW verdict", () => {
  it("shadow + orphans: verdict carries `orphanLines` so the wiring layer can emit post-commit", async () => {
    const detected = [
      orphan("item-1", ["NO_ACTIVE_ORDER", "QUANTITY_EXCEEDS_ORDER"]),
      orphan("item-2", ["NO_ACTIVE_ORDER"]),
    ];
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: detected });

    const verdict = await evaluateClinicalInvariant(ctx({ animalId: "animal-v1" }), {
      modeResolver: async () => "shadow",
    });

    expect(verdict.action).toBe("allow");
    if (verdict.action === "allow") {
      expect(verdict.disposition).toBe("WOULD_HAVE_BLOCKED_SHADOW");
      expect(verdict.orphanLines).toEqual(detected);
    }
  });

  it("shadow + clean orphanLines: verdict does NOT carry orphanLines", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });

    const verdict = await evaluateClinicalInvariant(ctx({ animalId: "animal-v2" }), {
      modeResolver: async () => "shadow",
    });

    expect(verdict).toEqual({ action: "allow" });
  });

  it("evaluator does NOT call logAudit directly anymore (post-commit emission is the wiring layer's job)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });

    await evaluateClinicalInvariant(ctx({ animalId: "animal-v3" }), {
      modeResolver: async () => "shadow",
    });

    // No logAudit call from the evaluator. PR 5.5 moved the emission
    // to the wiring layer's post-commit step so a tx rollback can
    // never persist a false-positive audit row (Codex P2 review).
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("counters still tick in the evaluator (shadow set semantics preserved)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER", "QUANTITY_EXCEEDS_ORDER"])],
    });

    await evaluateClinicalInvariant(ctx({ animalId: "animal-v4" }), {
      modeResolver: async () => "shadow",
    });

    const snap = getMetricsSnapshot().clinicalInvariant.shadowWouldHaveBlocked;
    expect(snap.total).toBe(1);
    expect(snap.noActiveOrder).toBe(1);
    expect(snap.quantityExceedsOrder).toBe(1);
  });
});

// ─── Emitter — direct invocation ───────────────────────────────────────────

describe("PR 5.5 — sampled shadow audit emitter (direct invocation)", () => {
  it("emits exactly one shadow audit row when called (AUTHORITY_OBS_V1=true)", () => {
    emitClinicalInvariantShadowWouldHaveBlockedAudit({
      clinicId: "clinic-1",
      animalId: "animal-direct-1",
      containerId: "container-1",
      requestId: "req-d1",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });

    expect(shadowAuditCalls()).toHaveLength(1);
    const [params] = shadowAuditCalls()[0]!;
    expect(params).toMatchObject({
      clinicId: "clinic-1",
      actionType: "clinical_invariant_shadow_would_have_blocked",
      targetId: "container-1",
      targetType: "container",
      performedBy: "system:clinical_invariant_evaluator",
    });
    const meta = (params as { metadata?: Record<string, unknown> }).metadata ?? {};
    expect(meta).toMatchObject({
      kind: "clinical_invariant_shadow",
      animalId: "animal-direct-1",
      containerId: "container-1",
      requestId: "req-d1",
      lineCount: 1,
    });
    expect(meta.reasonCodes).toEqual(["NO_ACTIVE_ORDER"]);
  });

  it("AUTHORITY_OBS_V1=false suppresses emission", () => {
    delete process.env.AUTHORITY_OBS_V1;
    emitClinicalInvariantShadowWouldHaveBlockedAudit({
      clinicId: "clinic-1",
      animalId: "animal-direct-2",
      containerId: "container-1",
      requestId: "req-d2",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    expect(shadowAuditCalls()).toHaveLength(0);
  });

  it("sampler dedupes second emission within 5-min window per (clinicId, animalId)", () => {
    for (let i = 0; i < 2; i++) {
      emitClinicalInvariantShadowWouldHaveBlockedAudit({
        clinicId: "clinic-1",
        animalId: "animal-direct-sampler",
        containerId: "container-1",
        requestId: `req-sampler-${i}`,
        orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
      });
    }
    expect(shadowAuditCalls()).toHaveLength(1);
  });

  it("different animalIds get independent sampler keys", () => {
    emitClinicalInvariantShadowWouldHaveBlockedAudit({
      clinicId: "clinic-1",
      animalId: "animal-multi-A",
      containerId: "container-1",
      requestId: "req-mA",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    emitClinicalInvariantShadowWouldHaveBlockedAudit({
      clinicId: "clinic-1",
      animalId: "animal-multi-B",
      containerId: "container-1",
      requestId: "req-mB",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    expect(shadowAuditCalls()).toHaveLength(2);
  });

  it("null animalId uses a stable placeholder sampler key", () => {
    emitClinicalInvariantShadowWouldHaveBlockedAudit({
      clinicId: "clinic-1",
      animalId: null,
      containerId: "container-1",
      requestId: "req-null-1",
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });
    expect(shadowAuditCalls()).toHaveLength(1);
    const meta =
      (shadowAuditCalls()[0]![0] as { metadata?: Record<string, unknown> }).metadata ?? {};
    expect(meta.animalId).toBeNull();
  });
});

// ─── Best-effort contract (CI-25) ──────────────────────────────────────────

describe("PR 5.5 — best-effort contract (CI-25)", () => {
  it("logAudit throw inside the emitter is swallowed and does not propagate", () => {
    logAuditMock.mockImplementation(() => {
      throw new Error("logAudit boom");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      emitClinicalInvariantShadowWouldHaveBlockedAudit({
        clinicId: "clinic-1",
        animalId: "animal-best-effort",
        containerId: "container-1",
        requestId: "req-bf",
        orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
      }),
    ).not.toThrow();

    // The emitter still entered logAudit (i.e., the call was made;
    // it just threw inside). The mock-spy proves attempt + swallow.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

// ─── PR 5.5 scope lock (only the shadow audit kind ships) ──────────────────

describe("PR 5.5 — scope lock: only the shadow audit kind ships", () => {
  it("evaluator shadow path with orphans does not call logAudit (post-commit emission only)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });

    await evaluateClinicalInvariant(ctx({ animalId: "animal-scope-1" }), {
      modeResolver: async () => "shadow",
    });

    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("evaluator enforce path with orphans does not call logAudit (denial audit lands in PR 5.7)", async () => {
    evaluateDispenseAgainstOrdersMock.mockResolvedValue({
      orphanLines: [orphan("item-1", ["NO_ACTIVE_ORDER"])],
    });

    await evaluateClinicalInvariant(ctx({ animalId: "animal-scope-2" }), {
      modeResolver: async () => "enforce",
    });

    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
