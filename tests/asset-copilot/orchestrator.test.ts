import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTemplateNarrative,
  explainEquipmentCopilot,
} from "../../server/services/asset-copilot-orchestrator.service.js";
import { ASSET_COPILOT_RESOLVER_VERSION } from "../../shared/contracts/asset-copilot.v1.js";
import type { CopilotAnswer } from "../../shared/contracts/asset-copilot.v1.js";

vi.mock("../../server/services/asset-copilot-resolve.service.js", () => ({
  resolveCopilotAnswer: vi.fn(),
}));

vi.mock("../../server/lib/anthropic-client.js", () => ({
  isAssetCopilotLlmEnabled: vi.fn(() => false),
  createClaudeTextCompletion: vi.fn(),
}));

import { resolveCopilotAnswer } from "../../server/services/asset-copilot-resolve.service.js";
import { isAssetCopilotLlmEnabled } from "../../server/lib/anthropic-client.js";

const mockedResolve = vi.mocked(resolveCopilotAnswer);
const mockedLlmEnabled = vi.mocked(isAssetCopilotLlmEnabled);

const SAMPLE_ANSWER: CopilotAnswer = {
  resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
  equipmentId: "eq-1",
  claims: [
    {
      key: "location",
      value: "Room 4",
      confidence: { evidenceStrength: "high", evidenceFreshness: "current" },
      citations: [
        {
          type: "room",
          id: "room-4",
          label: "Room 4",
          evidence: { observedAt: "2026-05-29T12:00:00.000Z" },
        },
      ],
    },
  ],
  unknowns: [],
  citations: [
    {
      type: "room",
      id: "room-4",
      label: "Room 4",
      evidence: { observedAt: "2026-05-29T12:00:00.000Z" },
    },
  ],
};

describe("asset copilot orchestrator", () => {
  beforeEach(() => {
    mockedResolve.mockReset();
    mockedLlmEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("buildTemplateNarrative includes claim lines", () => {
    const text = buildTemplateNarrative(SAMPLE_ANSWER, "Pump 217", "en");
    expect(text).toContain("Pump 217");
    expect(text).toContain("location: Room 4");
  });

  it("buildTemplateNarrative maps unknown codes to staff-facing copy", () => {
    const text = buildTemplateNarrative(
      {
        resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
        equipmentId: "eq-1",
        claims: [],
        unknowns: ["insufficient_validated_evidence"],
        citations: [],
      },
      "Glucometer — ICU",
      "en",
    );
    expect(text).not.toContain("insufficient_validated_evidence");
    expect(text).toContain("Not enough verified scan or custody evidence yet");
  });

  it("explainEquipmentCopilot returns template narrative when LLM disabled", async () => {
    mockedResolve.mockResolvedValue({
      answer: SAMPLE_ANSWER,
      graph: {
        clinicId: "clinic-1",
        equipmentId: "eq-1",
        loadedAt: new Date("2026-05-29T12:00:00.000Z"),
        equipment: {
          id: "eq-1",
          clinicId: "clinic-1",
          name: "Pump 217",
          custodyState: "docked",
          custodyStateSince: new Date("2026-05-29T12:00:00.000Z"),
          checkedOutById: null,
          checkedOutByEmail: null,
          checkedOutAt: null,
          checkedOutLocation: null,
          readinessState: "ready",
          usageState: "available",
          assetTypeId: null,
          roomId: "room-4",
          dockId: null,
          location: "Room 4",
          lastRfidSeenAt: null,
          lastRfidRoomId: null,
          lastSeen: new Date("2026-05-29T12:00:00.000Z"),
        },
        recentScans: [],
        recentTransfers: [],
        recentRfidReads: [],
        recentReturns: [],
        supersessionEvents: [],
        rooms: [{ id: "room-4", clinicId: "clinic-1", name: "Room 4" }],
        assetTypeConditions: [],
        unitConditionStates: [],
        activeStaging: [],
        waitlist: null,
      },
    });

    const result = await explainEquipmentCopilot({
      clinicId: "clinic-1",
      equipmentId: "eq-1",
    });

    expect(result.llmUsed).toBe(false);
    expect(result.validationFailed).toBe(false);
    expect(result.narrative).toContain("location: Room 4");
    expect(result.answer.claims).toHaveLength(1);
  });
});
