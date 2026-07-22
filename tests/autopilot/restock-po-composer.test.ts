import { describe, it, expect } from "vitest";
import {
  composeRestockPoProposal,
  computeSuggestedQuantity,
  AUTOPILOT_PO_SUPPLIER_PLACEHOLDER,
  type RestockPoDraftContent,
} from "../../server/lib/autopilot/restock-po-composer.js";
import type { RestockItemReadResult } from "../../server/lib/autopilot/restock-burn-reader.port.js";

const CLINIC_A = "clinic-a";
const SCAN_DATE = "2026-07-22";

function buildFlaggedItem(overrides: Partial<RestockItemReadResult> = {}): RestockItemReadResult {
  return {
    itemId: "item-1",
    inventoryItemRowId: "item-1",
    flagged: true,
    onHand: 8,
    reorderPoint: 10,
    parLevel: 20,
    containerRows: [
      { id: "ci-1", containerId: "container-1", quantity: 5, updatedAt: new Date("2026-07-22T06:00:00.000Z") },
      { id: "ci-2", containerId: "container-2", quantity: 3, updatedAt: new Date("2026-07-22T07:00:00.000Z") },
    ],
    ...overrides,
  };
}

describe("computeSuggestedQuantity (top-up-to-par rule)", () => {
  it("uses parLevel - onHand, floored at 1, when parLevel is set", () => {
    expect(computeSuggestedQuantity(buildFlaggedItem({ parLevel: 20, onHand: 8 }))).toBe(12);
  });

  it("floors at 1 rather than 0 or negative when onHand already meets/exceeds parLevel", () => {
    expect(computeSuggestedQuantity(buildFlaggedItem({ parLevel: 5, onHand: 8 }))).toBe(1);
  });

  it("falls back to reorderPoint when parLevel is null", () => {
    expect(computeSuggestedQuantity(buildFlaggedItem({ parLevel: null, reorderPoint: 10, onHand: 8 }))).toBe(10);
  });
});

describe("composeRestockPoProposal", () => {
  it("composes a NewActionProposalInput with kind restock_po_on_burn and the sanctioned supplier placeholder", () => {
    const input = composeRestockPoProposal({
      clinicId: CLINIC_A,
      scanDate: SCAN_DATE,
      flaggedItems: [buildFlaggedItem()],
      locale: "en",
    });

    expect(input.kind).toBe("restock_po_on_burn");
    expect(input.clinicId).toBe(CLINIC_A);
    expect(input.sourceSessionId).toBe(SCAN_DATE);
    const draft = input.draftContent as RestockPoDraftContent;
    expect(draft.supplierName).toBe(AUTOPILOT_PO_SUPPLIER_PLACEHOLDER);
  });

  it("draftContent lines use the top-up-to-par rule per flagged item", () => {
    const input = composeRestockPoProposal({
      clinicId: CLINIC_A,
      scanDate: SCAN_DATE,
      flaggedItems: [buildFlaggedItem({ itemId: "item-1", parLevel: 20, onHand: 8 })],
      locale: "en",
    });
    const draft = input.draftContent as RestockPoDraftContent;
    expect(draft.lines).toEqual([{ itemId: "item-1", quantitySuggested: 12 }]);
  });

  it("citations contain only observed rows — the container rows and the inventory item row — never a derived onHand total", () => {
    const item = buildFlaggedItem();
    const input = composeRestockPoProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, flaggedItems: [item], locale: "en" });

    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "ci-1", sourceTable: "vt_container_items" }),
    );
    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "ci-2", sourceTable: "vt_container_items" }),
    );
    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "item-1", sourceTable: "vt_items" }),
    );
    // no derived/computed value (e.g. the summed onHand=8, or the computed
    // suggested quantity=12) ever appears as a citedFacts sourceId
    const sourceIds = input.citedFacts.map((f) => f.sourceId);
    expect(sourceIds).not.toContain("8");
    expect(sourceIds).not.toContain("12");
    expect(input.citedFacts).toHaveLength(3);
  });

  it("only cites facts for flagged items, ignoring any unflagged item passed in error", () => {
    const flagged = buildFlaggedItem({ itemId: "item-1" });
    const input = composeRestockPoProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, flaggedItems: [flagged], locale: "en" });
    expect(input.draftContent as RestockPoDraftContent).toMatchObject({ lines: [{ itemId: "item-1", quantitySuggested: 12 }] });
  });

  it("summary is composed via the typed i18n key, not a hardcoded string", () => {
    const input = composeRestockPoProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, flaggedItems: [buildFlaggedItem()], locale: "en" });
    expect(input.summary).not.toContain("undefined");
    expect(input.summary.length).toBeGreaterThan(0);
    // Hebrew locale renders different copy for the same structured input — proves the summary is key-driven, not string-literal English baked in.
    const heInput = composeRestockPoProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, flaggedItems: [buildFlaggedItem()], locale: "he" });
    expect(heInput.summary).not.toBe(input.summary);
  });

  it("throws when given an empty flaggedItems array (nothing to propose)", () => {
    expect(() =>
      composeRestockPoProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, flaggedItems: [], locale: "en" }),
    ).toThrow();
  });
});
