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

  describe("coordinator_reassign_off_roster kind (§3)", () => {
    const coordinatorGroundTruth: ActionProposalCitedFact[] = [
      { sourceId: "coord-row-1", sourceTable: "vt_shift_equipment_coordinator", kind: "stale_coordinator_assignment", at: "2026-07-22T06:00:00.000Z" },
      { sourceId: "shift-row-1", sourceTable: "vt_shifts", kind: "roster_shift", at: "2026-07-22T00:00:00.000Z" },
    ];

    it("validates true when the coordinator kind's real citations (checked against its own reader's ground truth) are used", () => {
      const result = validateActionProposalCitations(coordinatorGroundTruth, coordinatorGroundTruth);
      expect(result.valid).toBe(true);
      expect(result.checks).toEqual([
        { sourceId: "coord-row-1", valid: true },
        { sourceId: "shift-row-1", valid: true },
      ]);
    });

    it("flags a fabricated sourceId for the coordinator kind as citation_not_grounded", () => {
      const tampered: ActionProposalCitedFact[] = [
        ...coordinatorGroundTruth,
        { sourceId: "fabricated-coord-99", sourceTable: "vt_shift_equipment_coordinator", kind: "stale_coordinator_assignment", at: "2026-07-22T06:10:00.000Z" },
      ];
      const result = validateActionProposalCitations(tampered, coordinatorGroundTruth);
      expect(result.valid).toBe(false);
      expect(result.checks).toContainEqual({
        sourceId: "fabricated-coord-99",
        valid: false,
        flag: "citation_not_grounded:fabricated-coord-99",
      });
    });
  });

  describe("restock_po_on_burn kind (§4)", () => {
    const restockGroundTruth: ActionProposalCitedFact[] = [
      { sourceId: "item-1", sourceTable: "vt_items", kind: "reorder_point_threshold", at: "2026-07-22T00:00:00.000Z" },
      { sourceId: "ci-1", sourceTable: "vt_container_items", kind: "on_hand_quantity", at: "2026-07-22T06:00:00.000Z" },
      { sourceId: "ci-2", sourceTable: "vt_container_items", kind: "on_hand_quantity", at: "2026-07-22T07:00:00.000Z" },
    ];

    it("validates true when the restock kind's real citations (checked against its own reader's ground truth) are used", () => {
      const result = validateActionProposalCitations(restockGroundTruth, restockGroundTruth);
      expect(result.valid).toBe(true);
      expect(result.checks).toEqual([
        { sourceId: "item-1", valid: true },
        { sourceId: "ci-1", valid: true },
        { sourceId: "ci-2", valid: true },
      ]);
    });

    it("flags a fabricated sourceId for the restock kind as citation_not_grounded", () => {
      const tampered: ActionProposalCitedFact[] = [
        ...restockGroundTruth,
        { sourceId: "fabricated-restock-99", sourceTable: "vt_container_items", kind: "on_hand_quantity", at: "2026-07-22T08:00:00.000Z" },
      ];
      const result = validateActionProposalCitations(tampered, restockGroundTruth);
      expect(result.valid).toBe(false);
      expect(result.checks).toContainEqual({
        sourceId: "fabricated-restock-99",
        valid: false,
        flag: "citation_not_grounded:fabricated-restock-99",
      });
    });

    it("flags a derived value (the summed onHand total) cited as if it were an observed row", () => {
      const tamperedWithDerivedValue: ActionProposalCitedFact[] = [
        ...restockGroundTruth,
        { sourceId: "8", sourceTable: "vt_container_items", kind: "on_hand_quantity", at: "2026-07-22T08:00:00.000Z" },
      ];
      const result = validateActionProposalCitations(tamperedWithDerivedValue, restockGroundTruth);
      expect(result.valid).toBe(false);
      expect(result.checks).toContainEqual({
        sourceId: "8",
        valid: false,
        flag: "citation_not_grounded:8",
      });
    });
  });

  describe("crash_cart_drift kind (§5)", () => {
    const crashCartGroundTruth: ActionProposalCitedFact[] = [
      { sourceId: "check-1", sourceTable: "vt_crash_cart_checks", kind: "check_missing_items", at: "2026-07-22T10:00:00.000Z" },
      { sourceId: "item-epi", sourceTable: "vt_crash_cart_items", kind: "missing_item", at: "2026-07-22T10:00:00.000Z" },
    ];

    it("validates true when the crash-cart kind's real citations (checked against its own reader's ground truth) are used", () => {
      const result = validateActionProposalCitations(crashCartGroundTruth, crashCartGroundTruth);
      expect(result.valid).toBe(true);
      expect(result.checks).toEqual([
        { sourceId: "check-1", valid: true },
        { sourceId: "item-epi", valid: true },
      ]);
    });

    it("flags a fabricated sourceId for the crash-cart kind as citation_not_grounded", () => {
      const tampered: ActionProposalCitedFact[] = [
        ...crashCartGroundTruth,
        { sourceId: "fabricated-cart-99", sourceTable: "vt_crash_cart_items", kind: "missing_item", at: "2026-07-22T10:05:00.000Z" },
      ];
      const result = validateActionProposalCitations(tampered, crashCartGroundTruth);
      expect(result.valid).toBe(false);
      expect(result.checks).toContainEqual({
        sourceId: "fabricated-cart-99",
        valid: false,
        flag: "citation_not_grounded:fabricated-cart-99",
      });
    });
  });
});
