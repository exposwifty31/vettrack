import { describe, it, expect } from "vitest";
import { computeBundleReadinessGate } from "../server/services/equipment-operational-state.service.js";
import type { AssetTypeCondition, UnitConditionState } from "../server/db.js";

const NOW = new Date("2026-01-01T12:00:00Z");

function makeCondition(overrides: Partial<AssetTypeCondition> = {}): AssetTypeCondition {
  return {
    id: "cond-1",
    clinicId: "clinic-1",
    assetTypeId: "at-1",
    conditionName: "Battery check",
    verificationMethod: "visual",
    staleAfterMinutes: 60,
    displayOrder: 0,
    createdAt: NOW,
    ...overrides,
  };
}

function makeState(overrides: Partial<UnitConditionState> = {}): UnitConditionState {
  return {
    id: "state-1",
    clinicId: "clinic-1",
    equipmentId: "eq-1",
    conditionId: "cond-1",
    verified: true,
    verifiedAt: new Date(NOW.getTime() - 10 * 60 * 1000), // 10 min ago — fresh
    verifiedById: null,
    notes: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("computeBundleReadinessGate — damage gate (T-24e · R-EQ-F3)", () => {
  it("demotes to not-ready when conditionStatus is non-'ok', even with otherwise-ready inputs", () => {
    const cond = makeCondition();
    const state = makeState();
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1", conditionStatus: "damaged" },
      [state],
      [cond],
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("stays ready when conditionStatus is 'ok' and other inputs are otherwise-ready (healthy path unaffected)", () => {
    const cond = makeCondition();
    const state = makeState();
    const result = computeBundleReadinessGate(
      { custodyState: "docked", assetTypeId: "at-1", conditionStatus: "ok" },
      [state],
      [cond],
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });
});
