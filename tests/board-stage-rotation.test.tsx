/**
 * @vitest-environment happy-dom
 *
 * TV board phase 1, Task 11 — the Equipment↔Ops stage rotation:
 *   - alternates every STAGE_ROTATION_MS when the Ops view has content;
 *   - single-view mode: stays "equipment" forever when Ops is empty;
 *   - alert locks the rotation to "equipment" instantly and it resumes after;
 *   - OpsStage renders queue detail (absent ≠ zero) + the relocated shift strip;
 *   - CommandBoard's header no longer carries the shift names (moved to Ops).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, cleanup, act } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import { OpsStage } from "@/features/command-board/components/board-stage-ops";
import {
  STAGE_ROTATION_MS,
  opsHasContent,
  useStageRotation,
} from "@/features/command-board/use-stage-rotation";
import type { BoardStateKind } from "@/features/command-board/board-state";
import { t } from "@/lib/i18n";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

function board(overrides: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-08-13T08:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: 4,
      ready: 4,
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

const SHIFT = [{ employeeName: "Dana Levi", role: "vet_tech" }];

afterEach(() => cleanup());

describe("useStageRotation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("alternates equipment→ops→equipment at the rotation cadence when ops has content", () => {
    const { result } = renderHook((p) => useStageRotation(p), {
      initialProps: { state: "all_clear" as BoardStateKind, opsHasContent: true },
    });
    expect(result.current).toBe("equipment");
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS));
    expect(result.current).toBe("ops");
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS));
    expect(result.current).toBe("equipment");
  });

  it("single-view mode: stays equipment forever when ops has no content", () => {
    const { result } = renderHook((p) => useStageRotation(p), {
      initialProps: { state: "all_clear" as BoardStateKind, opsHasContent: false },
    });
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS * 5));
    expect(result.current).toBe("equipment");
  });

  it("locks to equipment when state becomes alert mid-rotation and resumes after", () => {
    const { result, rerender } = renderHook((p) => useStageRotation(p), {
      initialProps: { state: "all_clear" as BoardStateKind, opsHasContent: true },
    });
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS));
    expect(result.current).toBe("ops");
    rerender({ state: "alert" as BoardStateKind, opsHasContent: true });
    expect(result.current).toBe("equipment"); // instant lock
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS * 3));
    expect(result.current).toBe("equipment"); // stays locked while alerting
    rerender({ state: "all_clear" as BoardStateKind, opsHasContent: true });
    expect(result.current).toBe("equipment"); // resumes from the equipment view
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS));
    expect(result.current).toBe("ops"); // rotation resumed
  });

  it("takeover states also lock to equipment (no rotation under stale/unconfigured)", () => {
    const { result } = renderHook((p) => useStageRotation(p), {
      initialProps: { state: "stale" as BoardStateKind, opsHasContent: true },
    });
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS * 2));
    expect(result.current).toBe("equipment");
  });
});

describe("opsHasContent", () => {
  it("false only when waitlist 0 AND staging 0 AND shift empty (absent blocks included)", () => {
    expect(opsHasContent(board({}), [])).toBe(false);
    expect(opsHasContent(board({ waitlist: { depth: 0 }, staging: { depth: 0 } }), [])).toBe(false);
    expect(opsHasContent(null, [])).toBe(false);
    expect(opsHasContent(undefined, [])).toBe(false);
  });

  it("true when any of waitlist depth, staging depth, or shift is non-empty", () => {
    expect(opsHasContent(board({ waitlist: { depth: 1 } }), [])).toBe(true);
    expect(opsHasContent(board({ staging: { depth: 2 } }), [])).toBe(true);
    expect(opsHasContent(board({}), SHIFT)).toBe(true);
  });
});

describe("OpsStage", () => {
  it("renders waitlist/staging depth detail when non-zero plus the relocated shift strip", () => {
    const { getByText, getByTestId } = render(
      <OpsStage board={board({ waitlist: { depth: 3 }, staging: { depth: 2 } })} currentShift={SHIFT} />,
    );
    expect(getByTestId("board-stage").getAttribute("data-stage")).toBe("ops");
    expect(getByText("3")).toBeTruthy();
    expect(getByText("2")).toBeTruthy();
    expect(getByText(t.board.opsShiftTitle)).toBeTruthy();
    expect(getByText("Dana Levi")).toBeTruthy();
    expect(getByText(t.profile.roles.vet_tech)).toBeTruthy();
  });

  it("renders the empty phrases for zero depths (zero-but-present, not absent)", () => {
    const { getByText } = render(
      <OpsStage board={board({ waitlist: { depth: 0 }, staging: { depth: 0 } })} currentShift={SHIFT} />,
    );
    expect(getByText(t.board.opsEmptyWaitlist)).toBeTruthy();
    expect(getByText(t.board.opsEmptyStaging)).toBeTruthy();
  });

  it("absent blocks render muted-unknown — never the empty phrase, never zeros", () => {
    const { queryByText, getAllByTestId } = render(<OpsStage board={board({})} currentShift={SHIFT} />);
    expect(queryByText(t.board.opsEmptyWaitlist)).toBeNull();
    expect(queryByText(t.board.opsEmptyStaging)).toBeNull();
    expect(getAllByTestId("board-block-unknown").length).toBeGreaterThanOrEqual(2);
  });
});

describe("CommandBoard shift relocation + rotation wiring", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function renderBoard(state: BoardStateKind = "all_clear") {
    const { hook } = memoryLocation({ path: "/equipment/board" });
    return render(
      <Router hook={hook}>
        <CommandBoard
          board={board({})}
          currentTime="2026-08-13T08:00:00.000Z"
          currentShift={SHIFT}
          state={state}
        />
      </Router>,
    );
  }

  it("header no longer contains the shift names; they appear on the Ops view after rotation", () => {
    const { queryByText, getByText, getByTestId } = renderBoard();
    // Initial view is equipment — the relocated shift strip is not on screen,
    // and the header does not carry the names anymore.
    expect(queryByText("Dana Levi")).toBeNull();
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS));
    expect(getByTestId("board-stage").getAttribute("data-stage")).toBe("ops");
    expect(getByText("Dana Levi")).toBeTruthy();
  });

  it("alert keeps the stage locked on equipment — the ops view never appears", () => {
    const { getByTestId } = renderBoard("alert");
    act(() => vi.advanceTimersByTime(STAGE_ROTATION_MS * 2));
    expect(getByTestId("board-stage").getAttribute("data-stage")).toBe("alert");
  });
});
