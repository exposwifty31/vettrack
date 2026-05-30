import { describe, expect, it } from "vitest";
import type { EvidenceGraph } from "../shared/equipment-intelligence.js";
import type { EquipmentContextSnapshot } from "../server/intelligence/context-builder.service.js";
import {
  detectOperationalRisks,
  hasActionableEvidence,
  toRecommendations,
} from "../server/intelligence/risk-detector.js";
import { filterValidEvidenceIds } from "../server/intelligence/evidence-graph.js";
import { resolveOpenAiApiKey } from "../server/intelligence/openai-client.js";
import { INSUFFICIENT_EVIDENCE_MESSAGE } from "../shared/equipment-intelligence.js";

describe("equipment intelligence risk detector", () => {
  const baseSnapshot: EquipmentContextSnapshot = {
    generatedAt: new Date().toISOString(),
    windowStart: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    windowEnd: new Date().toISOString(),
    equipmentCount: 1,
    openShiftSessionId: null,
    equipment: [
      {
        equipmentId: "eq-1",
        name: "Pump A",
        status: "ok",
        location: "ICU",
        roomName: "ICU 1",
        custodyState: "untracked",
        readinessState: "unknown",
        usageState: "available",
        checkedOutById: null,
        checkedOutAt: null,
        expectedReturnMinutes: null,
        lastSeenAt: null,
        lastMaintenanceDate: null,
        maintenanceIntervalDays: null,
        expiryDate: null,
        riskSignals: ["custody_untracked"],
      },
    ],
    metrics: {
      untrackedCount: 1,
      checkedOutCount: 0,
      overdueMaintenanceCount: 0,
      openAlertCount: 0,
      activeWaitlistCount: 0,
    },
  };

  const graph: EvidenceGraph = {
    nodes: [
      {
        id: "equipment:eq-1",
        type: "equipment",
        label: "Pump A",
        facts: { custodyState: "untracked" },
        occurredAt: null,
        relatedIds: [],
      },
    ],
    edges: [],
  };

  it("detects untracked custody with evidence ids", () => {
    const findings = detectOperationalRisks(baseSnapshot, graph);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.evidence).toContain("equipment:eq-1");
    const recs = toRecommendations(findings, 5);
    expect(recs[0]?.approvalRequired).toBe(true);
    expect(recs[0]?.confidence).toBeTruthy();
  });

  it("reports insufficient evidence when fleet empty", () => {
    const empty: EquipmentContextSnapshot = {
      ...baseSnapshot,
      equipmentCount: 0,
      equipment: [],
      metrics: { ...baseSnapshot.metrics, untrackedCount: 0 },
    };
    const findings = detectOperationalRisks(empty, { nodes: [], edges: [] });
    expect(findings).toHaveLength(0);
    expect(hasActionableEvidence(empty, { nodes: [], edges: [] }, findings)).toBe(false);
  });

  it("filters invalid evidence references", () => {
    const valid = filterValidEvidenceIds(graph, ["equipment:eq-1", "fake:id"]);
    expect(valid).toEqual(["equipment:eq-1"]);
  });

  it("uses OPENAI_API_KEY env convention", () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "  sk-test  ";
    expect(resolveOpenAiApiKey()).toBe("sk-test");
    delete process.env.OPENAI_API_KEY;
    expect(resolveOpenAiApiKey()).toBeNull();
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });

  it("exports insufficient evidence message constant", () => {
    expect(INSUFFICIENT_EVIDENCE_MESSAGE).toContain("Insufficient evidence");
  });
});
