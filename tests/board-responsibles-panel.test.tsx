/**
 * @vitest-environment happy-dom
 *
 * Responsibles v2 (TV board phase 1, spec §4) — board ResponsiblesPanel
 * rendering contract:
 * - `responsibles === null/undefined` (snapshot build failed/timed out) →
 *   muted-unknown card (`responsiblesUnavailable`) — NEVER the 0/5 aggregate
 *   (absent ≠ zero, binding).
 * - All five slots empty → single aggregate row ("0/5") + a 5-segment progress
 *   element filling LTR (Hebrew LTR-fill exception); no per-slot notMarked rows.
 * - ≥1 slot filled → named slots (same `board-responsibles-*` testids), with
 *   the remaining empty slots grouped into ONE muted line.
 * - Members without a senior → member count + amber "no senior" accent,
 *   `data-fill="filled_flagged"`. Coordinator `needs_confirmation` → name,
 *   flagged. Filled slots always show names.
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

describe("ResponsiblesPanel — unavailable (null/undefined) is not a gap", () => {
  it("renders the muted unavailable copy when responsibles is undefined (no crash)", () => {
    const { getByText, queryByText, getByTestId } = render(
      <ResponsiblesPanel responsibles={undefined} />,
    );
    expect(getByText(t.board.responsiblesTitle)).toBeTruthy();
    expect(getByTestId("board-responsibles")).toBeTruthy();
    expect(getByText(t.board.responsiblesUnavailable)).toBeTruthy();
    // Never the 0/5 aggregate — absent data is not "nobody signed in".
    expect(queryByText(t.board.responsiblesAggregate(0))).toBeNull();
    expect(queryByText(t.board.notMarked)).toBeNull();
  });

  it("renders the muted unavailable copy when responsibles is null", () => {
    const { getByText, queryByText } = render(<ResponsiblesPanel responsibles={null} />);
    expect(getByText(t.board.responsiblesUnavailable)).toBeTruthy();
    expect(queryByText(t.board.responsiblesAggregate(0))).toBeNull();
  });
});

describe("ResponsiblesPanel — all-empty aggregate", () => {
  it("renders the 0/5 aggregate row with an LTR 5-segment progress, no per-slot rows", () => {
    const { getByText, getByTestId, queryAllByText } = render(
      <ResponsiblesPanel responsibles={responsibles()} />,
    );
    expect(getByText(t.board.responsiblesAggregate(0))).toBeTruthy();
    expect(getByText(t.board.responsiblesNoneShift)).toBeTruthy();
    const progress = getByTestId("board-responsibles-progress");
    // Hebrew LTR-fill exception: progress fills left-to-right even in RTL.
    expect(progress.getAttribute("dir")).toBe("ltr");
    expect(progress.children.length).toBe(5);
    // The five notMarked rows are gone.
    expect(queryAllByText(t.board.notMarked)).toHaveLength(0);
  });
});

describe("ResponsiblesPanel — mixed fill", () => {
  it("renders the filled slot by name and groups the empties into ONE muted line", () => {
    const { getByTestId, getAllByTestId, queryByTestId } = render(
      <ResponsiblesPanel
        responsibles={responsibles({
          doctors: {
            icu: {
              senior: { name: "Dr. Senior", since: "2026-08-13T06:00:00.000Z" },
              members: [],
            },
            admission: EMPTY_TEAM,
            internal_medicine: EMPTY_TEAM,
          },
        })}
      />,
    );
    const icu = getByTestId("board-responsibles-icu");
    expect(icu.getAttribute("data-fill")).toBe("filled");
    expect(within(icu).getByText("Dr. Senior")).toBeTruthy();
    // Empty slots collapse into a single muted group line — not four rows.
    expect(getAllByTestId("board-responsibles-empty-group")).toHaveLength(1);
    const group = getByTestId("board-responsibles-empty-group");
    expect(group.textContent).toContain(t.board.seniorAdmission);
    expect(group.textContent).toContain(t.board.seniorInternal);
    expect(group.textContent).toContain(t.board.seniorTechnician);
    expect(group.textContent).toContain(t.board.equipmentCoordinator);
    expect(queryByTestId("board-responsibles-admission")).toBeNull();
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
    expect(icu.queryByText(t.board.notMarked)).toBeNull();
  });

  it("renders a members-without-senior team as a flagged member count with the amber no-senior accent", () => {
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
    const admission = getByTestId("board-responsibles-admission");
    expect(admission.getAttribute("data-fill")).toBe("filled_flagged");
    expect(within(admission).getByText(t.board.responsiblesDoctorCount(1))).toBeTruthy();
    expect(within(admission).getByText(t.board.responsiblesNoSenior)).toBeTruthy();
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
    const tech = getByTestId("board-responsibles-senior-technician");
    expect(tech.getAttribute("data-fill")).toBe("filled");
    expect(within(tech).getByText("Tami Tech")).toBeTruthy();
    const coord = getByTestId("board-responsibles-equipment-coordinator");
    expect(coord.getAttribute("data-fill")).toBe("filled");
    expect(within(coord).getByText("Coby Coord")).toBeTruthy();
  });

  it("renders a needs_confirmation coordinator by name, flagged", () => {
    const { getByTestId } = render(
      <ResponsiblesPanel
        responsibles={responsibles({
          equipmentCoordinator: { name: "Coby Coord", status: "needs_confirmation" },
        })}
      />,
    );
    const coord = getByTestId("board-responsibles-equipment-coordinator");
    expect(coord.getAttribute("data-fill")).toBe("filled_flagged");
    expect(within(coord).getByText("Coby Coord")).toBeTruthy();
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

  it("degrades to the unavailable copy when the snapshot key is absent (tolerant reader)", () => {
    const { getByTestId, getByText } = renderCommandBoard(undefined);
    expect(getByTestId("board-responsibles")).toBeTruthy();
    expect(getByText(t.board.responsiblesUnavailable)).toBeTruthy();
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
