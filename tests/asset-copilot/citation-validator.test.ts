import { describe, it, expect } from "vitest";
import { validateCitation } from "../../server/domain/equipment/copilot/citation-validator.js";
import { buildSyntheticEvidenceGraph } from "../../server/domain/equipment/evidence/graph.loader.js";
import type { Citation } from "../../shared/contracts/asset-copilot.v1.js";

const NOW = new Date("2026-05-29T12:00:00Z");

describe("validateCitation (validity only)", () => {
  it("accepts equipment citation present in graph", () => {
    const graph = buildSyntheticEvidenceGraph({
      clinicId: "c1",
      equipmentId: "eq-1",
      equipment: {
        id: "eq-1",
        clinicId: "c1",
        name: "Pump",
        custodyState: "docked",
        custodyStateSince: NOW,
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
        checkedOutLocation: null,
        readinessState: "ready",
        usageState: "available",
        assetTypeId: null,
        roomId: null,
        dockId: null,
        location: null,
        lastRfidSeenAt: null,
        lastRfidRoomId: null,
        lastSeen: null,
      },
    });
    const citation: Citation = {
      type: "equipment",
      id: "eq-1",
      label: "Pump",
      evidence: { observedAt: NOW.toISOString() },
    };
    expect(validateCitation(citation, graph).valid).toBe(true);
  });

  it("rejects citation id not in graph", () => {
    const graph = buildSyntheticEvidenceGraph({ clinicId: "c1", equipmentId: "eq-1" });
    const citation: Citation = {
      type: "scan",
      id: "missing",
      label: "Scan",
      evidence: { observedAt: NOW.toISOString() },
    };
    const result = validateCitation(citation, graph);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("citation_not_in_graph"))).toBe(true);
    }
  });
});
