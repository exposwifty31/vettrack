import { describe, it, expect } from "vitest";
import {
  composeCrashCartDriftProposal,
  type CrashCartMissingItemsDraftContent,
  type CrashCartStaleCheckDraftContent,
} from "../../server/lib/autopilot/crash-cart-drift-composer.js";
import type { CrashCartDriftReadResult } from "../../server/lib/autopilot/crash-cart-drift-reader.port.js";

const CLINIC_A = "clinic-a";
const SCAN_DATE = "2026-07-22";

function buildMissingItemsResult(overrides: Partial<CrashCartDriftReadResult> = {}): CrashCartDriftReadResult {
  return {
    lastCheck: {
      id: "check-1",
      performedAt: new Date("2026-07-22T10:00:00.000Z"),
      allPassed: false,
      itemsChecked: [
        { key: "epinephrine", label: "Epinephrine", checked: false },
        { key: "oxygen", label: "Oxygen", checked: true },
      ],
    },
    activeItems: [
      { id: "item-epi", key: "epinephrine", label: "Epinephrine" },
      { id: "item-o2", key: "oxygen", label: "Oxygen" },
    ],
    missingItemsFlagged: true,
    failedItems: [{ key: "epinephrine", label: "Epinephrine", itemRowId: "item-epi" }],
    staleFlagged: false,
    hasNeverBeenChecked: false,
    hoursSinceLastCheck: 2,
    thresholdHours: 24,
    ...overrides,
  };
}

function buildStaleResult(overrides: Partial<CrashCartDriftReadResult> = {}): CrashCartDriftReadResult {
  return {
    lastCheck: {
      id: "check-2",
      performedAt: new Date("2026-07-21T00:00:00.000Z"),
      allPassed: true,
      itemsChecked: [],
    },
    activeItems: [],
    missingItemsFlagged: false,
    failedItems: [],
    staleFlagged: true,
    hasNeverBeenChecked: false,
    hoursSinceLastCheck: 36,
    thresholdHours: 24,
    ...overrides,
  };
}

describe("composeCrashCartDriftProposal", () => {
  it("composes a missing_items draft citing the check row and each failed item's row, when missingItemsFlagged is true", () => {
    const reader = buildMissingItemsResult();
    const input = composeCrashCartDriftProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, reader, locale: "en" });

    expect(input.kind).toBe("crash_cart_drift");
    expect(input.clinicId).toBe(CLINIC_A);
    expect(input.sourceSessionId).toBe(SCAN_DATE);
    const draft = input.draftContent as CrashCartMissingItemsDraftContent;
    expect(draft.driftType).toBe("missing_items");
    expect(draft.failedItems).toEqual([{ key: "epinephrine", label: "Epinephrine", itemRowId: "item-epi" }]);

    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "check-1", sourceTable: "vt_crash_cart_checks" }),
    );
    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "item-epi", sourceTable: "vt_crash_cart_items" }),
    );
    // the still-checked item is never cited
    expect(input.citedFacts.some((f) => f.sourceId === "item-o2")).toBe(false);
  });

  it("composes a stale_check draft citing the last check's performedAt, when staleFlagged is true and a check exists", () => {
    const reader = buildStaleResult();
    const input = composeCrashCartDriftProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, reader, locale: "en" });

    expect(input.kind).toBe("crash_cart_drift");
    const draft = input.draftContent as CrashCartStaleCheckDraftContent;
    expect(draft.driftType).toBe("stale_check");
    expect(draft.hasNeverBeenChecked).toBe(false);
    expect(draft.hoursSinceLastCheck).toBe(36);

    expect(input.citedFacts).toEqual([
      expect.objectContaining({ sourceId: "check-2", sourceTable: "vt_crash_cart_checks" }),
    ]);
  });

  it("composes a stale_check draft citing active item rows when hasNeverBeenChecked is true (no check row to cite)", () => {
    const reader = buildStaleResult({
      lastCheck: null,
      hasNeverBeenChecked: true,
      hoursSinceLastCheck: null,
      activeItems: [{ id: "item-epi", key: "epinephrine", label: "Epinephrine" }],
    });
    const input = composeCrashCartDriftProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, reader, locale: "en" });

    const draft = input.draftContent as CrashCartStaleCheckDraftContent;
    expect(draft.hasNeverBeenChecked).toBe(true);
    expect(draft.lastCheckPerformedAt).toBeNull();
    expect(input.citedFacts).toEqual([
      expect.objectContaining({ sourceId: "item-epi", sourceTable: "vt_crash_cart_items" }),
    ]);
  });

  it("prioritizes missing_items over stale_check when both signals are true simultaneously", () => {
    const reader = buildMissingItemsResult({ staleFlagged: true, hoursSinceLastCheck: 30 });
    const input = composeCrashCartDriftProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, reader, locale: "en" });
    const draft = input.draftContent as CrashCartMissingItemsDraftContent;
    expect(draft.driftType).toBe("missing_items");
  });

  it("summaries are composed via typed i18n keys, not hardcoded strings — en and he differ", () => {
    const missingInput = composeCrashCartDriftProposal({
      clinicId: CLINIC_A,
      scanDate: SCAN_DATE,
      reader: buildMissingItemsResult(),
      locale: "en",
    });
    expect(missingInput.summary.length).toBeGreaterThan(0);
    expect(missingInput.summary).not.toContain("undefined");
    const missingInputHe = composeCrashCartDriftProposal({
      clinicId: CLINIC_A,
      scanDate: SCAN_DATE,
      reader: buildMissingItemsResult(),
      locale: "he",
    });
    expect(missingInputHe.summary).not.toBe(missingInput.summary);

    const staleInput = composeCrashCartDriftProposal({
      clinicId: CLINIC_A,
      scanDate: SCAN_DATE,
      reader: buildStaleResult(),
      locale: "en",
    });
    expect(staleInput.summary.length).toBeGreaterThan(0);
    expect(staleInput.summary).not.toContain("undefined");
    const staleInputHe = composeCrashCartDriftProposal({
      clinicId: CLINIC_A,
      scanDate: SCAN_DATE,
      reader: buildStaleResult(),
      locale: "he",
    });
    expect(staleInputHe.summary).not.toBe(staleInput.summary);
  });

  it("throws when neither missingItemsFlagged nor staleFlagged is true (nothing to propose)", () => {
    const reader = buildMissingItemsResult({ missingItemsFlagged: false, failedItems: [], staleFlagged: false });
    expect(() =>
      composeCrashCartDriftProposal({ clinicId: CLINIC_A, scanDate: SCAN_DATE, reader, locale: "en" }),
    ).toThrow();
  });
});
