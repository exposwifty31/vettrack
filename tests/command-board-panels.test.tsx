/**
 * @vitest-environment happy-dom
 *
 * Phase 5 (C2) — enrichment panels tolerant-reader contract. The /board kiosk is
 * an unattended wall display (wake-lock, auto-reload) with no operator to reload
 * a white screen, and each enrichment block degrades to undefined independently
 * server-side — so CommandBoard must render with any/all new blocks absent, and
 * render their counts when present. Extends the F1 empty-panes precedent one level
 * deeper (per-block undefined).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import { t } from "@/lib/i18n";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

function board(overrides: Partial<EquipmentCommandBoardSnapshot>): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-07-08T00:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: 0,
      ready: 0,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: [],
    alerts: [],
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
    ...overrides,
  };
}

afterEach(() => cleanup());

function renderBoard(b: EquipmentCommandBoardSnapshot) {
  const { hook } = memoryLocation({ path: "/equipment/board" });
  return render(
    <Router hook={hook}>
      <CommandBoard board={b} currentTime="2026-07-08T00:00:00.000Z" currentShift={[]} />
    </Router>,
  );
}

describe("CommandBoard enrichment panels — tolerant reader", () => {
  it("renders with ALL enrichment blocks undefined (no throw — kiosk-safe)", () => {
    expect(() => renderBoard(board({}))).not.toThrow();
  });

  it("renders with each block undefined individually (no throw)", () => {
    const full = {
      power: { plugged: 1, unplugged: 0, alert: 0 },
      docks: { total: 2, occupied: 1, ready: 1 },
      waitlist: { depth: 1 },
      staging: { depth: 1 },
    };
    for (const omit of ["power", "docks", "waitlist", "staging"] as const) {
      const partial = { ...full };
      delete partial[omit];
      expect(() => renderBoard(board(partial))).not.toThrow();
    }
  });

  it("renders each panel's title + counts when its block is present", () => {
    const { getByText, getAllByText } = renderBoard(
      board({
        power: { plugged: 3, unplugged: 2, alert: 1 },
        docks: { total: 8, occupied: 5, ready: 4 },
        waitlist: { depth: 7 },
        staging: { depth: 6 },
      }),
    );
    expect(getByText(t.board.power)).toBeTruthy();
    expect(getByText(t.board.docks)).toBeTruthy();
    expect(getByText(t.board.waitlist)).toBeTruthy();
    expect(getByText(t.board.staging)).toBeTruthy();
    expect(getByText("7")).toBeTruthy(); // waitlist depth
    expect(getByText("6")).toBeTruthy(); // staging depth
    expect(getAllByText(t.board.inQueue).length).toBeGreaterThanOrEqual(2); // waitlist + staging
  });

  it("labels a room-less byLocation bucket with the unassigned key", () => {
    const { getByText } = renderBoard(
      board({
        byLocation: [
          {
            locationId: undefined,
            locationName: "",
            totalCritical: 1,
            ready: 1,
            inUse: 0,
            blocked: 0,
            stale: 0,
            overdue: 0,
            unknown: 0,
          },
        ],
      }),
    );
    expect(getByText(t.board.unassigned)).toBeTruthy();
  });
});
