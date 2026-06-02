import { describe, it, expect } from "vitest";
import { validateCopilotAnswerSafety } from "../../server/domain/equipment/copilot/ai-safety-validator.js";
import type { EvidenceGraph } from "../../server/domain/equipment/evidence/graph.types.js";
import { ASSET_COPILOT_RESOLVER_VERSION } from "../../shared/contracts/asset-copilot.v1.js";

const baseGraph: EvidenceGraph = {
  clinicId: "c1",
  equipmentId: "eq1",
  equipment: {
    id: "eq1",
    clinicId: "c1",
    name: "Pump",
    custodyState: "docked",
    readinessState: "ready",
    usageState: "available",
  } as EvidenceGraph["equipment"],
  recentRfidReads: [],
  recentScans: [],
  recentTransfers: [],
  rooms: [],
  assetTypeConditions: [],
  activeStaging: [],
};

describe("ai safety validator (PR16)", () => {
  it("rejects financial claims without cost evidence", () => {
    const result = validateCopilotAnswerSafety(
      {
        resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
        equipmentId: "eq1",
        unknowns: [],
        citations: [],
        claims: [
          {
            key: "roi",
            value: "This unit saves $5000 per month guaranteed savings",
            confidence: { evidenceStrength: "low", evidenceFreshness: "current" },
            citations: [],
          },
        ],
      },
      baseGraph,
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.errors).toContain("financial_claim_without_cost_evidence");
    }
  });

  it("requires citation support per claim", () => {
    const result = validateCopilotAnswerSafety(
      {
        resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
        equipmentId: "eq1",
        unknowns: [],
        citations: [],
        claims: [
          {
            key: "ready",
            value: "Unit is ready",
            confidence: { evidenceStrength: "medium", evidenceFreshness: "current" },
            citations: [],
          },
        ],
      },
      baseGraph,
    );
    expect(result.safe).toBe(false);
  });
});
