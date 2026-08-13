/**
 * @vitest-environment happy-dom
 *
 * Phase 1 (Task 9) — full-stage takeover screens. The /board kiosk is an
 * unattended wall display: when the connection degrades to stale/offline the
 * board must SAY so loudly and keep showing the last-known state (clearly
 * labeled, never silently zeroed), and an unconfigured clinic must never see
 * success styling (no checkmark, no all-clear copy) for what is a
 * configuration hole.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  StaleTakeover,
  UnconfiguredTakeover,
  formatLastGoodTime,
} from "@/features/command-board/components/board-takeovers";
import { t } from "@/lib/i18n";
import type { DisplayConnection } from "@/hooks/use-display-connection";
import type { DisplaySnapshot, EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

afterEach(() => cleanup());

const LAST_SUCCESS_AT = new Date("2026-08-13T10:18:00").getTime();

function connection(over: Partial<DisplayConnection> = {}): DisplayConnection {
  return { state: "stale", lastSuccessAt: LAST_SUCCESS_AT, missedPolls: 30, ...over };
}

function makeBoard(over: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-08-13T08:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: 12,
      ready: 9,
      inUse: 2,
      blocked: 1,
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

function makeSnapshot(over: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    currentTime: "10:18",
    currentShift: [],
    hospitalizations: [],
    equipment: [],
    upcomingTasks: [],
    overdueTasks: [],
    activeAlertCount: 0,
    totalOverdueCount: 0,
    crashCartStatus: null,
    codeBlueSession: null,
    commandBoard: makeBoard(),
    responsibles: null,
    ...over,
  };
}

describe("StaleTakeover", () => {
  it("stale connection shows the stale headline, not the offline one", () => {
    const { getByText, queryByText } = render(
      <StaleTakeover connection={connection({ state: "stale" })} lastSnapshot={makeSnapshot()} />,
    );
    expect(getByText(t.board.stateStale)).toBeTruthy();
    expect(queryByText(t.board.stateOffline)).toBeNull();
  });

  it("offline connection shows the offline headline", () => {
    const { getByText, queryByText } = render(
      <StaleTakeover connection={connection({ state: "offline" })} lastSnapshot={makeSnapshot()} />,
    );
    expect(getByText(t.board.stateOffline)).toBeTruthy();
    expect(queryByText(t.board.stateStale)).toBeNull();
  });

  it("shows the last-good-data time derived from lastSuccessAt", () => {
    const { getByText } = render(
      <StaleTakeover connection={connection()} lastSnapshot={makeSnapshot()} />,
    );
    const time = formatLastGoodTime(LAST_SUCCESS_AT);
    expect(time).toMatch(/^\d{1,2}:\d{2}$/); // clock time, minute granularity
    expect(getByText(t.board.lastGoodAt(time))).toBeTruthy();
  });

  it("omits the last-good-data line when there was never a success", () => {
    const { queryByTestId } = render(
      <StaleTakeover
        connection={connection({ lastSuccessAt: null })}
        lastSnapshot={undefined}
      />,
    );
    expect(queryByTestId("board-lastgood")).toBeNull();
  });

  it("renders the last-known overview values under the lastKnown label — never zeroed", () => {
    const { getByText } = render(
      <StaleTakeover connection={connection()} lastSnapshot={makeSnapshot()} />,
    );
    expect(getByText(t.board.lastKnown)).toBeTruthy();
    // Real last-known values from the fixture (ready 9 of 12) must survive.
    const container = getByText(t.board.lastKnown).closest("[data-testid='board-lastknown']");
    expect(container).toBeTruthy();
    expect(container!.textContent).toContain("9");
    expect(container!.textContent).toContain("12");
  });

  it("omits the last-known block when there is no cached board", () => {
    const { queryByText } = render(
      <StaleTakeover
        connection={connection()}
        lastSnapshot={makeSnapshot({ commandBoard: null })}
      />,
    );
    expect(queryByText(t.board.lastKnown)).toBeNull();
  });
});

describe("UnconfiguredTakeover", () => {
  it("shows the unconfigured headline and management-console hint", () => {
    const { getByText } = render(<UnconfiguredTakeover />);
    expect(getByText(t.board.stateUnconfigured)).toBeTruthy();
    expect(getByText(t.board.stateUnconfiguredHint)).toBeTruthy();
  });

  it("contains no checkmark glyph and none of the all-clear success copy", () => {
    const { container } = render(<UnconfiguredTakeover />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/[✓✔✅]/);
    // The all-clear evidence phrasing must never appear on a config-hole screen.
    const successSuffix = t.board.allClearEvidence(1, 1).split("1").pop() ?? "";
    expect(successSuffix.length).toBeGreaterThan(0);
    expect(text).not.toContain(successSuffix.trim());
  });
});
