/**
 * Phase 5 PR 5.2 — Clinical-invariant evaluator OFF-MODE INVARIANT
 * (Phase 5 plan §5 CI-27, §15 PR 5.2 forbidden scope).
 *
 * Proves the evaluator issues ZERO clinical-validation queries when
 * the resolved mode is `off`. Uses a query-spy that wraps every
 * member access on the caller-provided `tx` — any access whatsoever
 * causes the test to fail.
 *
 * This is the dedicated off-invariant test that complements
 * `tests/authority-clinical-invariant-evaluator.test.ts`. The plan
 * §15 PR 5.2 calls it out by name.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  appointments: {},
  hospitalizations: {},
  inventoryItems: {},
}));

vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: vi.fn().mockResolvedValue(null),
}));

import { evaluateClinicalInvariant } from "../server/lib/authority/enforcement/clinical-invariant.evaluator.js";
import { __resetClinicalInvariantConfigCacheForTests } from "../server/lib/authority/enforcement/clinical-invariant.config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import type { ClinicalInvariantContext } from "../server/lib/authority/enforcement/clinical-invariant.types.js";

/**
 * Tx proxy that throws on any property access. If the evaluator
 * touches `tx.select`, `tx.transaction`, `tx.execute`, etc., this
 * proxy will fire — proving the off-mode short-circuit is genuine.
 */
function makeTxThrowingProxy(): ClinicalInvariantContext["tx"] {
  return new Proxy({} as ClinicalInvariantContext["tx"], {
    get(_target, prop) {
      throw new Error(
        `CI-27 VIOLATION: evaluator accessed tx.${String(prop)} in off mode`,
      );
    },
  });
}

beforeEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  delete process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
});

afterEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  resetMetrics();
  delete process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
});

describe("clinical-invariant evaluator — off-mode invariant (CI-27)", () => {
  it("off mode performs ZERO tx accesses (query-spy proxy)", async () => {
    const verdict = await evaluateClinicalInvariant(
      {
        tx: makeTxThrowingProxy(),
        clinicId: "clinic-1",
        animalId: "animal-1",
        containerId: "container-1",
        lines: [
          { itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" },
        ],
        isEmergency: false,
        bypassReason: null,
        requestId: "req-1",
      },
      { modeResolver: async () => "off" },
    );
    expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
  });

  it("off mode performs ZERO tx accesses even with multiple lines and a nullable animalId", async () => {
    const verdict = await evaluateClinicalInvariant(
      {
        tx: makeTxThrowingProxy(),
        clinicId: "clinic-1",
        animalId: null,
        containerId: "container-1",
        lines: [
          { itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" },
          { itemId: "item-2", quantity: 2, label: "Drug Y", code: "DY" },
        ],
        isEmergency: false,
        bypassReason: null,
        requestId: "req-2",
      },
      { modeResolver: async () => "off" },
    );
    expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
  });

  it("off mode performs ZERO tx accesses even with isEmergency=true (off short-circuits before emergency check)", async () => {
    const verdict = await evaluateClinicalInvariant(
      {
        tx: makeTxThrowingProxy(),
        clinicId: "clinic-1",
        animalId: "animal-1",
        containerId: "container-1",
        lines: [],
        isEmergency: true,
        bypassReason: "EMERGENCY_CPR",
        requestId: "req-3",
      },
      { modeResolver: async () => "off" },
    );
    expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
  });

  it("off mode does not move any clinical-invariant counter", async () => {
    await evaluateClinicalInvariant(
      {
        tx: makeTxThrowingProxy(),
        clinicId: "clinic-1",
        animalId: "animal-1",
        containerId: "container-1",
        lines: [
          { itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" },
        ],
        isEmergency: false,
        bypassReason: null,
        requestId: "req-4",
      },
      { modeResolver: async () => "off" },
    );
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.resolved).toEqual({ off: 0, shadow: 0, enforce: 0 });
    expect(snap.shadowWouldHaveBlocked).toEqual({
      total: 0,
      noPatientLinked: 0,
      noActiveHospitalization: 0,
      noActiveOrder: 0,
      quantityExceedsOrder: 0,
    });
  });

  it("repeated off-mode calls remain query-free (no caching side-effect leaks)", async () => {
    const ctx: ClinicalInvariantContext = {
      tx: makeTxThrowingProxy(),
      clinicId: "clinic-1",
      animalId: "animal-1",
      containerId: "container-1",
      lines: [{ itemId: "item-1", quantity: 1, label: "Drug X", code: "DX" }],
      isEmergency: false,
      bypassReason: null,
      requestId: "req-5",
    };
    for (let i = 0; i < 25; i++) {
      const verdict = await evaluateClinicalInvariant(ctx, { modeResolver: async () => "off" });
      expect(verdict).toEqual({ action: "allow", disposition: "OFF" });
    }
  });
});
