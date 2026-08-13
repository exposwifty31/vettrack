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
import type { BoardStateKind } from "@/features/command-board/board-state";
import { t } from "@/lib/i18n";
import type { BoardResponsibles, EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

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

function renderBoard(
  b: EquipmentCommandBoardSnapshot,
  responsibles?: BoardResponsibles | null,
  state: BoardStateKind = "all_clear",
) {
  const { hook } = memoryLocation({ path: "/equipment/board" });
  return render(
    <Router hook={hook}>
      <CommandBoard
        board={b}
        currentTime="2026-07-08T00:00:00.000Z"
        currentShift={[]}
        responsibles={responsibles}
        state={state}
      />
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

  it("renders the bottom-band panels (power, docks) with title + counts when present", () => {
    const { getByText, getByTestId } = renderBoard(
      board({
        power: { plugged: 3, unplugged: 2, alert: 1 },
        docks: { total: 8, occupied: 5, ready: 4 },
      }),
    );
    expect(getByText(t.board.power)).toBeTruthy();
    expect(getByText(t.board.docks)).toBeTruthy();
    // Active power alert surfaces in its own cell (severity → red + icon).
    expect(getByTestId("board-power-alerts").textContent).toContain("1");
    // Waitlist/staging depth render on the Ops rotation face (OpsStage), not the
    // bottom band or the equipment evidence face — spec §2 keeps the queue detail
    // on one face only (no identical numbers on both faces of the rotation).
  });

  // Task 10 — the calm/pressure threshold machine is replaced by the
  // state-driven stage: the container passes `state`, the board renders it.
  it("renders the locked exception stage when state is alert", () => {
    const { getByTestId } = renderBoard(board({}), undefined, "alert");
    expect(getByTestId("board-stage").getAttribute("data-stage")).toBe("alert");
  });

  it("renders the evidence stage when state is all_clear", () => {
    const { getByTestId } = renderBoard(board({}), undefined, "all_clear");
    expect(getByTestId("board-stage").getAttribute("data-stage")).toBe("evidence");
  });

  it("renders the power card as muted-unknown when power is absent — never zeros", () => {
    const { getAllByTestId } = renderBoard(
      board({ docks: { total: 2, occupied: 1, ready: 1 } }),
    );
    const unknowns = getAllByTestId("board-block-unknown");
    const powerUnknown = unknowns.find((el) => el.textContent?.includes(t.board.power));
    expect(powerUnknown).toBeTruthy();
    expect(powerUnknown!.textContent).toContain(t.board.blockUnavailable);
    expect(powerUnknown!.textContent).not.toContain("0");
  });

  it("renders the docks card as muted-unknown when docks is absent — never zeros", () => {
    const { getAllByTestId } = renderBoard(
      board({ power: { plugged: 1, unplugged: 1, alert: 0 } }),
    );
    const unknowns = getAllByTestId("board-block-unknown");
    const docksUnknown = unknowns.find((el) => el.textContent?.includes(t.board.docks));
    expect(docksUnknown).toBeTruthy();
    expect(docksUnknown!.textContent).toContain(t.board.blockUnavailable);
    expect(docksUnknown!.textContent).not.toContain("0");
  });

  it("renders the responsibles card as unavailable (NOT the 0/5 aggregate) when responsibles is null", () => {
    const { getByText, queryByText } = renderBoard(board({}), null);
    expect(getByText(t.board.responsiblesUnavailable)).toBeTruthy();
    expect(queryByText(t.board.responsiblesAggregate(0))).toBeNull();
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
