/**
 * @vitest-environment happy-dom
 *
 * TV board phase 1 (Task 10) — state-driven stage replacing calm/pressure.
 * CommandBoard consumes `state: BoardStateKind` as a prop (presentational; the
 * container computes it) and renders:
 *   - all_clear → evidence composition (check emblem + "N of M · checked now"
 *     + one monitored-equipment tile per byType row) — never a lone checkmark.
 *   - alert → exception cards sorted severity→elapsed, minute-granularity
 *     downtime, severity edge rail, top-3 + overflow line.
 *   - the top band + state strip render in BOTH (anchor invariant), and the
 *     responsibles panel never unmounts.
 *   - activeEmergency != null renders the alert-stage content with the
 *     PressureMain-era linked-equipment cards (incl. data-tv-focusable).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import type { BoardStateKind } from "@/features/command-board/board-state";
import { t } from "@/lib/i18n";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import type { EquipmentBoardUnitRow } from "../shared/equipment-board";

const NOW_ISO = "2026-08-13T10:00:00.000Z";

function unit(over: Partial<EquipmentBoardUnitRow>): EquipmentBoardUnitRow {
  return {
    equipmentId: "u1",
    displayName: "Unit u1",
    status: "blocked",
    blockingReasons: [],
    citationsCount: 0,
    truthHref: "#",
    ...over,
  };
}

function board(over: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: NOW_ISO,
    clinicId: "c1",
    overview: {
      totalCritical: 12,
      ready: 12,
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
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderBoard(
  b: EquipmentCommandBoardSnapshot,
  state: BoardStateKind,
  opts: { tvMode?: boolean } = {},
) {
  const { hook } = memoryLocation({ path: "/board" });
  return render(
    <Router hook={hook}>
      <CommandBoard
        board={b}
        currentTime={NOW_ISO}
        currentShift={[]}
        state={state}
        tvMode={opts.tvMode}
      />
    </Router>,
  );
}

describe("all_clear stage — evidence composition, not a lone checkmark", () => {
  it("renders the check emblem, the evidence phrase, and one tile per byType row", () => {
    const { getByTestId, getByText } = renderBoard(
      board({
        byType: [
          {
            typeName: "Ventilator",
            typeId: "ty-vent",
            total: 4,
            ready: 4,
            inUse: 0,
            blocked: 0,
            stale: 0,
            overdue: 0,
            unknown: 0,
            belowMinimumReady: false,
          },
          {
            typeName: "Defibrillator",
            typeId: "ty-defib",
            total: 8,
            ready: 8,
            inUse: 0,
            blocked: 0,
            stale: 0,
            overdue: 0,
            unknown: 0,
            belowMinimumReady: false,
          },
        ],
      }),
      "all_clear",
    );
    expect(getByTestId("board-allclear")).toBeTruthy();
    expect(getByText(t.board.allClearEvidence(12, 12))).toBeTruthy();
    const vent = getByTestId("board-type-tile-ty-vent");
    expect(vent.textContent).toContain("Ventilator");
    expect(vent.textContent).toContain("4/4");
    const defib = getByTestId("board-type-tile-ty-defib");
    expect(defib.textContent).toContain("Defibrillator");
    expect(defib.textContent).toContain("8/8");
  });
});

describe("attention stage — evidence composition without the all-clear emblem", () => {
  it("renders the evidence face, omits the check emblem, keeps the byType tiles", () => {
    const { getByTestId, queryByTestId } = renderBoard(
      board({
        waitlist: { depth: 2 },
        byType: [
          {
            typeName: "Ventilator",
            typeId: "ty-vent",
            total: 4,
            ready: 4,
            inUse: 0,
            blocked: 0,
            stale: 0,
            overdue: 0,
            unknown: 0,
            belowMinimumReady: false,
          },
        ],
      }),
      "attention",
    );
    expect(getByTestId("board-stage").getAttribute("data-stage")).toBe("evidence");
    // The check emblem is gated on all_clear only — attention is "needs a look",
    // never "all good", so it must NOT reassure with a green checkmark.
    expect(queryByTestId("board-allclear")).toBeNull();
    expect(getByTestId("board-type-tile-ty-vent").textContent).toContain("Ventilator");
  });
});

describe("alert stage — locked exception cards", () => {
  it("sorts exception cards severity→elapsed and shows minute-granularity downtime", () => {
    const { container, getByTestId } = renderBoard(
      board({
        overview: { ...board().overview, ready: 10, blocked: 1, stale: 1 },
        criticalUnits: [
          // stale for 30 min — LESS severe than blocked despite longer downtime
          unit({
            equipmentId: "u-stale",
            displayName: "Pump S",
            status: "stale",
            lastEvidenceAt: "2026-08-13T09:30:00.000Z",
          }),
          // blocked for 12 min — most severe, must sort FIRST
          unit({
            equipmentId: "u-blocked",
            displayName: "Vent B",
            status: "blocked",
            lastEvidenceAt: "2026-08-13T09:48:00.000Z",
          }),
        ],
      }),
      "alert",
    );
    const cards = Array.from(container.querySelectorAll('[data-testid^="board-unit-row-"]'));
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "board-unit-row-u-blocked",
      "board-unit-row-u-stale",
    ]);
    // Severity edge rail attribute drives the rail color.
    expect(getByTestId("board-unit-row-u-blocked").getAttribute("data-severity")).toBe("blocked");
    // Downtime at minute granularity: 12 min and 30 min.
    expect(getByTestId("board-unit-row-u-blocked").textContent).toContain(t.board.downFor(12));
    expect(getByTestId("board-unit-row-u-stale").textContent).toContain(t.board.downFor(30));
  });

  it("caps the stage at 3 exception cards and renders the overflow line", () => {
    const units = Array.from({ length: 5 }, (_, i) =>
      unit({
        equipmentId: `u-${i}`,
        displayName: `Unit ${i}`,
        status: "blocked",
        lastEvidenceAt: `2026-08-13T09:${String(10 + i).padStart(2, "0")}:00.000Z`,
      }),
    );
    const { container, getByText } = renderBoard(board({ criticalUnits: units }), "alert");
    const cards = container.querySelectorAll('[data-testid^="board-unit-row-"]');
    expect(cards.length).toBe(3);
    expect(getByText(t.board.alertOverflow(2))).toBeTruthy();
  });

  it("a down unit with no timestamps shows no downtime figure and sorts last within its tier", () => {
    const { container, getByTestId } = renderBoard(
      board({
        overview: { ...board().overview, ready: 10, blocked: 2 },
        criticalUnits: [
          // blocked, NO lastEvidenceAt/lastHumanConfirmationAt → unknown downtime.
          unit({ equipmentId: "u-undated", displayName: "Vent U", status: "blocked" }),
          // blocked, dated 12 min ago → same tier, but dated sorts BEFORE undated.
          unit({
            equipmentId: "u-dated",
            displayName: "Vent D",
            status: "blocked",
            lastEvidenceAt: "2026-08-13T09:48:00.000Z",
          }),
        ],
      }),
      "alert",
    );
    // POSITIVE_INFINITY fallback: the undated unit sorts AFTER the dated one.
    const order = Array.from(container.querySelectorAll('[data-testid^="board-unit-row-"]')).map(
      (c) => c.getAttribute("data-testid"),
    );
    expect(order).toEqual(["board-unit-row-u-dated", "board-unit-row-u-undated"]);
    // The dated card shows minute-granularity downtime; the undated card omits the
    // figure entirely — never a "NaN דק׳" from a null timestamp.
    expect(getByTestId("board-unit-row-u-dated").textContent).toContain(t.board.downFor(12));
    const undated = getByTestId("board-unit-row-u-undated").textContent ?? "";
    expect(undated).not.toContain("NaN");
    // Derive the minutes unit from i18n rather than embedding a Hebrew literal in
    // source (forbidden by tests/i18n-no-hebrew-in-source.test.ts): the undated card
    // must carry no downtime figure at all.
    const minutesUnit = t.board.downFor(0).replace(/[\d\s]/g, "");
    expect(undated).not.toContain(minutesUnit);
  });
});

describe("anchor invariant — top band + state strip in every non-takeover state", () => {
  it.each(["all_clear", "alert"] as const)("renders the anchor in %s", (state) => {
    const b =
      state === "alert"
        ? board({ criticalUnits: [unit({ equipmentId: "u-x", status: "blocked" })] })
        : board();
    const { getByTestId } = renderBoard(b, state);
    expect(getByTestId("board-top-band")).toBeTruthy();
    expect(getByTestId("board-state-strip").getAttribute("data-state")).toBe(state);
    // Responsibles never unmount (bottom band).
    expect(getByTestId("board-responsibles")).toBeTruthy();
  });
});

describe("active emergency — alert-stage content with linked-equipment cards", () => {
  it("renders linked-equipment cards with the PR #178 tv-focus metadata preserved", () => {
    const { container } = renderBoard(
      board({
        activeEmergency: {
          sessionId: "cb-1",
          startedAt: NOW_ISO,
          elapsedMs: 60_000,
          linkedEquipment: [
            {
              equipmentId: "lk-1",
              displayName: "Crash Defib",
              currentStatus: "in_use",
              locationName: "ICU",
            },
          ],
        },
      }),
      // The classifier is emergency-blind (Code Blue is handled upstream) —
      // the STAGE must still show emergency content on activeEmergency alone.
      "all_clear",
      { tvMode: true },
    );
    const linked = container.querySelector('[data-tv-id="linked-lk-1"]');
    expect(linked).toBeTruthy();
    expect(linked!.hasAttribute("data-tv-focusable")).toBe(true);
    expect(linked!.textContent).toContain("Crash Defib");
  });
});

describe("takeover states replace the stage", () => {
  it("stale renders the takeover, not the equipment stage", () => {
    const { getByTestId, queryByTestId } = renderBoard(board(), "stale");
    expect(getByTestId("board-takeover").getAttribute("data-kind")).toBe("stale");
    expect(queryByTestId("board-allclear")).toBeNull();
  });

  it("unconfigured renders the takeover with no success copy", () => {
    const { getByTestId, queryByTestId, queryByText } = renderBoard(
      board({ overview: { ...board().overview, totalCritical: 0, ready: 0 } }),
      "unconfigured",
    );
    expect(getByTestId("board-takeover").getAttribute("data-kind")).toBe("unconfigured");
    expect(queryByTestId("board-allclear")).toBeNull();
    expect(queryByText(t.board.allCriticalReady)).toBeNull();
  });
});
