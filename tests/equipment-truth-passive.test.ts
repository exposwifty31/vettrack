import { describe, it, expect } from "vitest";
import {
  getLatestRfidCitation,
  truthHasPassiveRfidSignal,
  truthNeedsLocationConfirm,
} from "../src/lib/equipment-truth-passive";
import type { EquipmentTruthResponse } from "../shared/equipment-truth";

function baseTruth(overrides: Partial<EquipmentTruthResponse> = {}): EquipmentTruthResponse {
  return {
    equipmentId: "eq-1",
    resolverVersion: "v1.0.0-m0",
    asOfMs: Date.now(),
    location: { summary: "unknown", claims: [], unknowns: ["no_authoritative_location"] },
    deployability: {
      fullDeployable: false,
      custodyState: "docked",
      readinessState: "ready",
      usageState: "available",
      bundleGate: { ok: true },
      claims: [],
      unknowns: [],
    },
    custodian: { claims: [], unknowns: ["no_active_custodian"], lastCorroboratedAt: null },
    citations: [],
    ...overrides,
  };
}

describe("equipment-truth-passive", () => {
  it("detects location confirm need", () => {
    expect(truthNeedsLocationConfirm(baseTruth())).toBe(true);
    expect(
      truthNeedsLocationConfirm(
        baseTruth({
          location: { summary: "room:ICU", claims: [], unknowns: [] },
        }),
      ),
    ).toBe(false);
  });

  it("picks latest RFID citation", () => {
    const truth = baseTruth({
      citations: [
        {
          type: "rfid",
          id: "r1",
          label: "Bay A",
          evidence: { observedAt: "2026-01-01T10:00:00.000Z" },
        },
        {
          type: "rfid",
          id: "r2",
          label: "Bay B",
          evidence: { observedAt: "2026-06-01T12:00:00.000Z" },
        },
      ],
    });
    expect(getLatestRfidCitation(truth.citations)?.label).toBe("Bay B");
  });

  it("detects passive RFID when newer than scans", () => {
    const truth = baseTruth({
      citations: [
        {
          type: "scan",
          id: "s1",
          label: "Scan",
          evidence: { observedAt: "2026-01-01T10:00:00.000Z" },
        },
        {
          type: "rfid",
          id: "r1",
          label: "Door",
          evidence: { observedAt: "2026-06-01T12:00:00.000Z" },
        },
      ],
    });
    expect(truthHasPassiveRfidSignal(truth)).toBe(true);
  });
});
