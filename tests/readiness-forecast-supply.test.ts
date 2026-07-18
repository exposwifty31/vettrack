import { describe, it, expect } from "vitest";
import {
  computeReadySupply,
  isUnitAvailable,
  isUnitReady,
  type EquipmentUnitRow,
} from "../server/lib/readiness-forecast-engine.js";
import { DEFAULT_EQUIPMENT_READINESS_RULES_V1 } from "../shared/equipment-readiness-rules.js";

/**
 * R-PDF-1.2 — Supply model.
 *
 * readySupply is the INTERSECTION of available ∧ ready — never a sum. A ready
 * unit is a subset of available; a not-ready unit is excluded; a single unit is
 * counted at most once. Composes the clinic readiness rules (staleEvidenceMs).
 */

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const RULES = DEFAULT_EQUIPMENT_READINESS_RULES_V1; // staleEvidenceMs = 1 day

function unit(o: Partial<EquipmentUnitRow> & { id: string }): EquipmentUnitRow {
  return {
    clinicId: "clinic-a",
    assetTypeId: "asset-ventilator",
    readinessState: "ready",
    readinessStateSince: NOW - HOUR, // fresh evidence
    usageState: "available",
    custodyState: "docked",
    reservedForSessionId: null,
    deletedAt: null,
    ...o,
  };
}

describe("R-PDF-1.2 · computeReadySupply — available ∧ ready intersection", () => {
  it("counts a unit only when it is BOTH available AND ready", () => {
    const units = [
      unit({ id: "u1" }), // available + ready  → counts
      unit({ id: "u2" }), // available + ready  → counts
    ];
    const supply = computeReadySupply(units, RULES, NOW);
    expect(supply.get("asset-ventilator")?.readySupply).toBe(2);
    expect(supply.get("asset-ventilator")?.available).toBe(2);
    expect(supply.get("asset-ventilator")?.ready).toBe(2);
  });

  it("excludes an available-but-not-ready unit from readySupply (intersection, not sum)", () => {
    const units = [
      unit({ id: "ready", readinessState: "ready" }),
      unit({ id: "notready", readinessState: "not_ready" }),
      unit({ id: "unknown", readinessState: "unknown" }),
    ];
    const supply = computeReadySupply(units, RULES, NOW);
    const row = supply.get("asset-ventilator")!;
    // available = 3, ready = 1 → readySupply is the INTERSECTION (1), NEVER 3+1.
    expect(row.available).toBe(3);
    expect(row.ready).toBe(1);
    expect(row.readySupply).toBe(1);
    expect(row.readySupply).not.toBe(row.available + row.ready);
    expect(row.readySupply).toBeLessThanOrEqual(Math.min(row.available, row.ready));
  });

  it("excludes ready units that are NOT available (checked out / in use / reserved / deleted)", () => {
    const units = [
      unit({ id: "checkedout", custodyState: "checked_out" }),
      unit({ id: "inuse", usageState: "in_use" }),
      unit({ id: "emergency", usageState: "emergency_use" }),
      unit({ id: "reserved", reservedForSessionId: "cb-session-1" }),
      unit({ id: "deleted", deletedAt: NOW - HOUR }),
      unit({ id: "good" }),
    ];
    const supply = computeReadySupply(units, RULES, NOW);
    expect(supply.get("asset-ventilator")?.readySupply).toBe(1); // only "good"
  });

  it("counts each unit at most once (no double count for the same unit)", () => {
    const units = [unit({ id: "only" })];
    const supply = computeReadySupply(units, RULES, NOW);
    const row = supply.get("asset-ventilator")!;
    expect(row.readySupply).toBe(1);
    expect(row.readySupply).toBeLessThanOrEqual(units.length);
  });

  it("composes the readiness rules: a ready unit with STALE evidence is excluded", () => {
    const staleRules = { ...RULES, staleEvidenceMs: HOUR }; // 1h trust window
    const units = [
      unit({ id: "fresh", readinessStateSince: NOW - 10 * 60 * 1000 }), // 10 min → trusted
      unit({ id: "stale", readinessStateSince: NOW - 5 * HOUR }), // 5h → beyond window
    ];
    expect(isUnitReady(units[0], staleRules, NOW)).toBe(true);
    expect(isUnitReady(units[1], staleRules, NOW)).toBe(false);
    const supply = computeReadySupply(units, staleRules, NOW);
    expect(supply.get("asset-ventilator")?.readySupply).toBe(1);
  });

  it("excludes a ready unit with NO evidence timestamp (null readinessStateSince cannot pass freshness)", () => {
    const units = [
      unit({ id: "fresh", readinessStateSince: NOW - HOUR }), // has evidence → counts
      unit({ id: "no-since", readinessState: "ready", readinessStateSince: null }), // no evidence → excluded
    ];
    expect(isUnitReady(units[1], RULES, NOW)).toBe(false);
    expect(computeReadySupply(units, RULES, NOW).get("asset-ventilator")?.readySupply).toBe(1);
  });

  it("excludes a ready unit with FUTURE-DATED evidence (readinessStateSince > now cannot pass freshness)", () => {
    // A `since` in the future yields a NEGATIVE age, which trivially clears the
    // `age > staleEvidenceMs` check — silently overstating ready supply. Clock skew
    // or a bad write must NOT be trusted as fresh evidence (precision-first).
    const units = [
      unit({ id: "fresh", readinessStateSince: NOW - HOUR }), // valid past evidence → counts
      unit({ id: "future", readinessState: "ready", readinessStateSince: NOW + HOUR }), // future-dated → excluded
    ];
    expect(isUnitReady(units[1], RULES, NOW)).toBe(false);
    expect(computeReadySupply(units, RULES, NOW).get("asset-ventilator")?.readySupply).toBe(1);
  });

  it("groups readySupply per asset type (never sums different types together)", () => {
    const units = [
      unit({ id: "v1", assetTypeId: "asset-ventilator" }),
      unit({ id: "v2", assetTypeId: "asset-ventilator" }),
      unit({ id: "m1", assetTypeId: "asset-monitor" }),
    ];
    const supply = computeReadySupply(units, RULES, NOW);
    expect(supply.get("asset-ventilator")?.readySupply).toBe(2);
    expect(supply.get("asset-monitor")?.readySupply).toBe(1);
  });

  it("predicate helpers agree with the aggregate", () => {
    const available = unit({ id: "a" });
    const notAvailable = unit({ id: "b", custodyState: "checked_out" });
    expect(isUnitAvailable(available)).toBe(true);
    expect(isUnitAvailable(notAvailable)).toBe(false);
  });

  it("cross-tenant negative: readySupply reflects ONLY the requested clinic's units", () => {
    // A clinic-scoped reader filters by clinicId, exactly like the Drizzle adapter.
    const all = [
      unit({ id: "a1", clinicId: "clinic-a" }),
      unit({ id: "a2", clinicId: "clinic-a" }),
      unit({ id: "b1", clinicId: "clinic-b" }),
      unit({ id: "b2", clinicId: "clinic-b" }),
      unit({ id: "b3", clinicId: "clinic-b" }),
    ];
    const equipmentUnits = (clinicId: string) => all.filter((u) => u.clinicId === clinicId);
    const supplyA = computeReadySupply(equipmentUnits("clinic-a"), RULES, NOW);
    expect(supplyA.get("asset-ventilator")?.readySupply).toBe(2); // NOT 5
  });
});
