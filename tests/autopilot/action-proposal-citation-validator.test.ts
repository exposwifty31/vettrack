import { describe, it, expect } from "vitest";
import { validateActionProposalCitations } from "../../server/lib/autopilot/action-proposal-citation-validator.js";
import type { ActionProposalCitedFact } from "../../server/lib/autopilot/action-proposal-types.js";

const groundTruth: ActionProposalCitedFact[] = [
  { sourceId: "audit-1", sourceTable: "vt_audit_logs", kind: "custody", at: "2026-07-22T08:00:00.000Z" },
  { sourceId: "outbox-2", sourceTable: "vt_event_outbox", kind: "alert", at: "2026-07-22T08:05:00.000Z" },
];

describe("action-proposal citation validator", () => {
  it("validates true when every cited fact is present in ground truth", () => {
    const result = validateActionProposalCitations(groundTruth, groundTruth);
    expect(result.valid).toBe(true);
    expect(result.checks).toEqual([
      { sourceId: "audit-1", valid: true },
      { sourceId: "outbox-2", valid: true },
    ]);
  });

  it("flags a fabricated sourceId as citation_not_grounded", () => {
    const tampered: ActionProposalCitedFact[] = [
      ...groundTruth,
      { sourceId: "fabricated-99", sourceTable: "vt_audit_logs", kind: "custody", at: "2026-07-22T08:10:00.000Z" },
    ];
    const result = validateActionProposalCitations(tampered, groundTruth);
    expect(result.valid).toBe(false);
    expect(result.checks).toContainEqual({
      sourceId: "fabricated-99",
      valid: false,
      flag: "citation_not_grounded:fabricated-99",
    });
    // the untampered citations still pass independently
    expect(result.checks.filter((c) => c.valid)).toHaveLength(2);
  });

  it("is a pure function with no side effects on empty input", () => {
    const result = validateActionProposalCitations([], []);
    expect(result).toEqual({ valid: true, checks: [] });
  });
});
