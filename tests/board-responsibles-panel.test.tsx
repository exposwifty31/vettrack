/**
 * @vitest-environment happy-dom
 *
 * Doctor shift gate (spec 2026-08-13 §3) — board ResponsiblesPanel rendering
 * contract. Five slots ALWAYS render (ICU senior / admission senior / internal
 * medicine senior / senior technician / equipment coordinator); an empty slot
 * shows the muted notMarked copy (never a red/blinking state), members without
 * a senior get the small noSeniorMarked label, and a null/undefined
 * `responsibles` payload (snapshot build failed/timed out) degrades to all
 * five slots in the notMarked state — kiosk-safe, no throw.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ResponsiblesPanel } from "@/features/command-board/components/board-panels";
import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import { t } from "@/lib/i18n";
import type { BoardResponsibles, EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

const EMPTY_TEAM = { senior: null, members: [] };

function responsibles(overrides: Partial<BoardResponsibles> = {}): BoardResponsibles {
  return {
    doctors: {
      icu: EMPTY_TEAM,
      admission: EMPTY_TEAM,
      internal_medicine: EMPTY_TEAM,
    },
    seniorTechnician: null,
    equipmentCoordinator: { name: null, status: "unresolved" },
    ...overrides,
  };
}

/** Board fixture mirroring tests/command-board-panels.test.tsx. */
function board(): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-08-13T00:00:00.000Z",
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
  };
}

/** The board renders member since-times as HH:mm (he-IL, 24h). */
function sinceTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

afterEach(() => cleanup());

const SLOT_TEST_IDS = [
  "board-responsibles-icu",
  "board-responsibles-admission",
  "board-responsibles-internal-medicine",
  "board-responsibles-senior-technician",
  "board-responsibles-equipment-coordinator",
] as const;

describe("ResponsiblesPanel — rendering contract", () => {
  it("renders all five slots in the notMarked state when responsibles is undefined (no crash)", () => {
    const { getByText, getAllByText, getByTestId } = render(
      <ResponsiblesPanel responsibles={undefined} />,
    );
    expect(getByText(t.board.responsiblesTitle)).toBeTruthy();
    for (const id of SLOT_TEST_IDS) expect(getByTestId(id)).toBeTruthy();
    expect(getByText(t.board.seniorIcu)).toBeTruthy();
    expect(getByText(t.board.seniorAdmission)).toBeTruthy();
    expect(getByText(t.board.seniorInternal)).toBeTruthy();
    expect(getByText(t.board.seniorTechnician)).toBeTruthy();
    expect(getByText(t.board.equipmentCoordinator)).toBeTruthy();
    expect(getAllByText(t.board.notMarked)).toHaveLength(5);
  });

  it("renders all five slots in the notMarked state when responsibles is null", () => {
    const { getAllByText } = render(<ResponsiblesPanel responsibles={null} />);
    expect(getAllByText(t.board.notMarked)).toHaveLength(5);
  });

  it("renders the senior prominently and members beneath with since-times", () => {
    const { getByTestId } = render(
      <ResponsiblesPanel
        responsibles={responsibles({
          doctors: {
            icu: {
              senior: { name: "Dr. Senior", since: "2026-08-13T06:00:00.000Z" },
              members: [
                { name: "Dr. Early", since: "2026-08-13T05:30:00.000Z" },
                { name: "Dr. Late", since: "2026-08-13T07:15:00.000Z" },
              ],
            },
            admission: EMPTY_TEAM,
            internal_medicine: EMPTY_TEAM,
          },
        })}
      />,
    );
    const icu = within(getByTestId("board-responsibles-icu"));
    expect(icu.getByText("Dr. Senior")).toBeTruthy();
    expect(icu.getByText("Dr. Early")).toBeTruthy();
    expect(icu.getByText("Dr. Late")).toBeTruthy();
    expect(
      icu.getByText(t.board.sincePrefix(sinceTime("2026-08-13T05:30:00.000Z"))),
    ).toBeTruthy();
    // A populated slot never shows notMarked or noSeniorMarked.
    expect(icu.queryByText(t.board.notMarked)).toBeNull();
    expect(icu.queryByText(t.board.noSeniorMarked)).toBeNull();
  });

  it("labels a members-without-senior team with noSeniorMarked", () => {
    const { getByTestId } = render(
      <ResponsiblesPanel
        responsibles={responsibles({
          doctors: {
            icu: EMPTY_TEAM,
            admission: {
              senior: null,
              members: [{ name: "Dr. Alone", since: "2026-08-13T05:00:00.000Z" }],
            },
            internal_medicine: EMPTY_TEAM,
          },
        })}
      />,
    );
    const admission = within(getByTestId("board-responsibles-admission"));
    expect(admission.getByText(t.board.noSeniorMarked)).toBeTruthy();
    expect(admission.getByText("Dr. Alone")).toBeTruthy();
    expect(admission.queryByText(t.board.notMarked)).toBeNull();
  });

  it("renders senior technician and equipment coordinator names when present", () => {
    const { getByTestId } = render(
      <ResponsiblesPanel
        responsibles={responsibles({
          seniorTechnician: { name: "Tami Tech" },
          equipmentCoordinator: { name: "Coby Coord", status: "auto" },
        })}
      />,
    );
    expect(
      within(getByTestId("board-responsibles-senior-technician")).getByText("Tami Tech"),
    ).toBeTruthy();
    expect(
      within(getByTestId("board-responsibles-equipment-coordinator")).getByText("Coby Coord"),
    ).toBeTruthy();
  });
});

describe("CommandBoard — responsibles wiring", () => {
  function renderCommandBoard(
    r: BoardResponsibles | null | undefined,
    boardOverride?: EquipmentCommandBoardSnapshot,
  ) {
    const { hook } = memoryLocation({ path: "/board" });
    return render(
      <Router hook={hook}>
        <CommandBoard
          board={boardOverride ?? board()}
          currentTime="2026-08-13T00:00:00.000Z"
          currentShift={[]}
          responsibles={r}
        />
      </Router>,
    );
  }

  it("mounts the panel in the calm layout with data", () => {
    const { getByTestId } = renderCommandBoard(
      responsibles({ seniorTechnician: { name: "Tami Tech" } }),
    );
    expect(getByTestId("board-responsibles")).toBeTruthy();
    expect(
      within(getByTestId("board-responsibles-senior-technician")).getByText("Tami Tech"),
    ).toBeTruthy();
  });

  it("still mounts all five notMarked slots when the snapshot key is absent (tolerant reader)", () => {
    const { getByTestId, getAllByText } = renderCommandBoard(undefined);
    expect(getByTestId("board-responsibles")).toBeTruthy();
    expect(getAllByText(t.board.notMarked)).toHaveLength(5);
  });

  it("keeps the panel mounted in pressure mode (active emergency)", () => {
    const pressureBoard = board();
    pressureBoard.activeEmergency = {
      sessionId: "cb-1",
      startedAt: "2026-08-13T00:00:00.000Z",
      elapsedMs: 60_000,
      linkedEquipment: [],
    };
    const { getByTestId, getByText } = renderCommandBoard(
      responsibles({ seniorTechnician: { name: "Tami Tech" } }),
      pressureBoard,
    );
    // Pressure branch is live (its high-load banner renders)…
    expect(getByText(t.board.highLoad)).toBeTruthy();
    // …and the responsibles panel is still mounted with its slot content.
    expect(getByTestId("board-responsibles")).toBeTruthy();
    expect(
      within(getByTestId("board-responsibles-senior-technician")).getByText("Tami Tech"),
    ).toBeTruthy();
  });
});
