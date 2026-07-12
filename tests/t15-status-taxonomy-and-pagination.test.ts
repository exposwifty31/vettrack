/**
 * T15 (MEDIUM audit sweep) — two display-coherence defects on the equipment
 * status LIST surface (src/pages/equipment-list.tsx + EquipmentTriageList):
 *
 * 1. Taxonomy mismatch — the "operational" triage-tier section header and
 *    the per-item DeployabilityBadge pill draw from two DIFFERENT axes:
 *    `equipmentTriageTier()` groups on `eq.status` (health/workflow — ok /
 *    issue / maintenance / checked-out), while the pill renders
 *    `eq.readinessState` (deployability verification, evidence-graph
 *    resolved, defaults to "unknown" until confirmed). Before this fix, the
 *    Hebrew label for the operational tier reused the literal "OK" string
 *    (`equipmentList.triageOperational === status.ok === "תקין"`), so an
 *    item with `status: "ok"` + `readinessState: "unknown"` rendered under
 *    a header asserting "OK" while its own pill said "Unknown" — reading as
 *    a flat contradiction even though the two fields are legitimately
 *    independent. Fix: give the tier header its own distinct wording
 *    ("תפעולי" / "Operational" — English already used a different word;
 *    Hebrew is now aligned with existing codebase precedent at
 *    equipmentList.insightOperational) so the header no longer claims the
 *    same "OK" assertion the pill can independently contradict. No grouping
 *    logic changed — same axes, clearer scoping.
 *
 * 2. Pagination contradiction — the "N of M" summary
 *    (t.equipmentList.paginationCount) used `displayList.length` (the FULL
 *    filtered count) for "shown" even when the list is paginated to
 *    PAGE_SIZE-item pages, while "page X of Y" derived from the same
 *    `displayList.length` sliced by PAGE_SIZE. With 62 items and
 *    PAGE_SIZE=9 this produced "62 of 62 · page 1 of 7" — a direct
 *    contradiction. Fix: resolveEquipmentListShownCount() (new,
 *    src/lib/equipment-list-pagination.ts) returns the current page's
 *    actual slice length when not virtualized, matching what's rendered.
 */
import { describe, it, expect } from "vitest";
import { t } from "@/lib/i18n";
import { equipmentTriageTier } from "@/lib/design-tokens";
import { resolveDeployabilityVerdict } from "@/components/equipment/DeployabilityBadge";
import {
  EQUIPMENT_LIST_PAGE_SIZE,
  resolveEquipmentListShownCount,
} from "@/lib/equipment-list-pagination";

describe("T15 — status list taxonomy coherence", () => {
  it("the operational tier header no longer asserts the equipment-status 'ok' claim", () => {
    // Pre-fix, triageOperational and status.ok were both the literal string
    // "תקין" — this assertion fails against that pre-fix state.
    expect(t.equipmentList.triageOperational).not.toBe(t.status.ok);
  });

  it("an item with status 'ok' + readiness 'unknown' lands in the operational tier while its deployability pill legitimately reads 'unknown' — two distinct axes, not a status contradiction", () => {
    const eq = {
      status: "ok",
      checkedOutById: null as string | null,
    };
    expect(equipmentTriageTier(eq)).toBe("operational");

    const verdict = resolveDeployabilityVerdict({
      custodyState: "docked",
      readinessState: "unknown",
      usageState: "available",
      fullDeployable: false,
    });
    expect(verdict?.label).toBe(t.operationalState.readinessState.unknown);

    // The header's wording must never collide with the per-item verdict it
    // can legitimately disagree with, on either axis.
    const operationalHeader = t.equipmentList.triageOperational;
    expect(operationalHeader).not.toBe(verdict?.label);
    expect(operationalHeader).not.toBe(t.status.ok);
  });

  it("attention/in-use tiers are unaffected by the header wording fix", () => {
    expect(equipmentTriageTier({ status: "issue", checkedOutById: null })).toBe("attention");
    expect(equipmentTriageTier({ status: "ok", checkedOutById: "user-1" })).toBe("in_use");
  });
});

describe("T15 — equipment list pagination count consistency", () => {
  it("62 items at the real page size produce 7 pages, and page 1 shows a 9-item slice — not '62 of 62'", () => {
    const displayListLength = 62;
    const totalPages = Math.ceil(displayListLength / EQUIPMENT_LIST_PAGE_SIZE);
    expect(totalPages).toBe(7);

    const page1ItemsLength = Math.min(EQUIPMENT_LIST_PAGE_SIZE, displayListLength);
    const shown = resolveEquipmentListShownCount(false, displayListLength, page1ItemsLength);

    expect(shown).toBe(9);
    // Guards directly against the audit contradiction: "62 of 62 · page 1 of 7".
    expect(shown).not.toBe(displayListLength);
  });

  it("the final partial page shows only its remainder, still consistent with the total page count", () => {
    const displayListLength = 62;
    const totalPages = Math.ceil(displayListLength / EQUIPMENT_LIST_PAGE_SIZE);
    const lastPageItemsLength = displayListLength - (totalPages - 1) * EQUIPMENT_LIST_PAGE_SIZE;

    const shown = resolveEquipmentListShownCount(false, displayListLength, lastPageItemsLength);

    expect(shown).toBe(8);
    expect(shown).toBeLessThanOrEqual(EQUIPMENT_LIST_PAGE_SIZE);
  });

  it("when everything fits on one page, 'shown' correctly equals the total (no contradiction to guard against)", () => {
    const displayListLength = 5;
    const shown = resolveEquipmentListShownCount(false, displayListLength, displayListLength);
    expect(shown).toBe(displayListLength);
  });

  it("virtualized lists render every filtered item, so 'shown' is the full display count (no page slicing to disagree with)", () => {
    const shown = resolveEquipmentListShownCount(true, 150, EQUIPMENT_LIST_PAGE_SIZE);
    expect(shown).toBe(150);
  });
});
