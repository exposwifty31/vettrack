/**
 * @vitest-environment happy-dom
 *
 * R-M1.3 — Command Board RFID chip render. The pinned discriminator states
 * `external_zone` (boundary/dock NULL side) and `unresolved` (no resolvable room)
 * MUST render as DISTINCT, non-blank surfaces — neither collapses to a blank/null
 * room. A resolved RFID room renders its name; the board stays kiosk-safe.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import { t } from "@/lib/i18n";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import type { EquipmentBoardUnitRow } from "../shared/equipment-board";

function unit(overrides: Partial<EquipmentBoardUnitRow>): EquipmentBoardUnitRow {
  return {
    equipmentId: "eq-1",
    displayName: "Ventilator A",
    status: "blocked", // non-ready/in_use so it lands in the needs-attention list (UnitRow)
    blockingReasons: [],
    citationsCount: 0,
    truthHref: "/api/equipment/eq-1/truth",
    ...overrides,
  };
}

function board(units: EquipmentBoardUnitRow[]): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-07-17T00:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: units.length,
      ready: 0,
      inUse: 0,
      blocked: units.length,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: units,
    alerts: [],
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
  };
}

afterEach(() => cleanup());

function renderBoard(b: EquipmentCommandBoardSnapshot) {
  const { hook } = memoryLocation({ path: "/equipment/board" });
  return render(
    <Router hook={hook}>
      <CommandBoard board={b} currentTime="2026-07-17T00:00:00.000Z" currentShift={[]} />
    </Router>,
  );
}

describe("CommandBoard — RFID chip discriminator render", () => {
  it("renders the external-zone chip as a distinct, non-blank surface", () => {
    const { getByTestId } = renderBoard(
      board([
        unit({
          rfid: {
            lastSeenAt: "2026-07-17T00:00:00.000Z",
            readerId: "reader-1",
            locationKind: "external_zone",
            locationName: "ER",
            confidence: "medium",
          },
        }),
      ]),
    );
    const chip = getByTestId("board-unit-rfid-eq-1");
    expect(chip.getAttribute("data-rfid-kind")).toBe("external_zone");
    expect(chip.textContent).toContain(t.board.rfidExternalZone);
    expect(chip.textContent?.trim()).not.toBe("");
  });

  it("renders the unresolved state as a distinct, non-blank surface", () => {
    const { getByTestId } = renderBoard(
      board([
        unit({
          rfid: {
            lastSeenAt: "2026-07-17T00:00:00.000Z",
            readerId: null,
            locationKind: "unresolved",
            confidence: "low",
          },
        }),
      ]),
    );
    const chip = getByTestId("board-unit-rfid-eq-1");
    expect(chip.getAttribute("data-rfid-kind")).toBe("unresolved");
    expect(chip.textContent).toContain(t.board.rfidUnresolved);
    expect(chip.textContent?.trim()).not.toBe("");
  });

  it("external_zone and unresolved render with DIFFERENT labels (neither collapses)", () => {
    const external = renderBoard(
      board([
        unit({
          equipmentId: "ext",
          rfid: { lastSeenAt: "2026-07-17T00:00:00.000Z", readerId: "r", locationKind: "external_zone", confidence: "medium" },
        }),
      ]),
    );
    const externalChip = external.getByTestId("board-unit-rfid-ext");
    cleanup();
    const unresolved = renderBoard(
      board([
        unit({
          equipmentId: "unr",
          rfid: { lastSeenAt: "2026-07-17T00:00:00.000Z", readerId: null, locationKind: "unresolved", confidence: "low" },
        }),
      ]),
    );
    const unresolvedChip = unresolved.getByTestId("board-unit-rfid-unr");
    expect(externalChip.getAttribute("data-rfid-kind")).not.toBe(
      unresolvedChip.getAttribute("data-rfid-kind"),
    );
  });

  it("renders the resolved RFID room name for a 'room' locationKind", () => {
    const { getByTestId } = renderBoard(
      board([
        unit({
          rfid: {
            lastSeenAt: "2026-07-17T00:00:00.000Z",
            readerId: "reader-1",
            locationKind: "room",
            locationName: "Ward B",
            confidence: "high",
          },
        }),
      ]),
    );
    const chip = getByTestId("board-unit-rfid-eq-1");
    expect(chip.getAttribute("data-rfid-kind")).toBe("room");
    expect(chip.textContent).toContain("Ward B");
  });

  it("renders no RFID chip when the unit has no rfid block (kiosk-safe)", () => {
    const { queryByTestId } = renderBoard(board([unit({})]));
    expect(queryByTestId("board-unit-rfid-eq-1")).toBeNull();
  });

  // WCAG AA: the category-prefix span must not composite its foreground token below
  // 4.5:1 via opacity. vt-text-2xs is small text, so the 4.5:1 threshold applies and
  // the prefix must render at full token opacity.
  it("renders the RFID category prefix without an opacity modifier (AA contrast)", () => {
    const { getByTestId } = renderBoard(
      board([
        unit({
          rfid: {
            lastSeenAt: "2026-07-17T00:00:00.000Z",
            readerId: "reader-1",
            locationKind: "room",
            locationName: "Ward B",
            confidence: "high",
          },
        }),
      ]),
    );
    const chip = getByTestId("board-unit-rfid-eq-1");
    const prefix = Array.from(chip.querySelectorAll("span")).find(
      (el) => el.textContent === t.board.rfidTag,
    );
    expect(prefix).toBeDefined();
    expect(prefix?.className).not.toMatch(/opacity-70/);
  });
});
