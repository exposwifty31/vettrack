/**
 * @vitest-environment happy-dom
 *
 * Task 13 — kiosk night dim. Client-clock window (22:00–06:00, documented
 * constants — no server schedule source in Phase 1) with two unconditional
 * overrides: an active `alert` board state and an active Code Blue never dim.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "@/lib/event-reducer";
import {
  useNightDim,
  NIGHT_DIM_START_HOUR,
  NIGHT_DIM_END_HOUR,
} from "@/board/use-night-dim";

// BoardShell chrome-only deps that need sockets / wake-lock / URL context — all
// irrelevant to the dim/drift wiring under test.
vi.mock("@/board/KioskAwake", () => ({ KioskAwake: () => null }));
vi.mock("@/board/useBoardCoPresence", () => ({
  useBoardCoPresence: () => ({
    selectEntity: () => {},
    peerSelections: [],
    presentMembers: [],
    peerCursors: [],
  }),
}));
vi.mock("@/board/BoardCoPresenceOverlay", () => ({ BoardCoPresenceOverlay: () => null }));
vi.mock("@/board/useBoardAutoReload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/board/useBoardAutoReload")>();
  return { ...actual, useBoardAutoReload: () => {} };
});
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useLocation: () => ["/board", () => {}] };
});

import { BoardShell } from "@/board/BoardShell";

function run(opts: Parameters<typeof useNightDim>[0]): boolean {
  const { result } = renderHook(() => useNightDim(opts));
  return result.current;
}

describe("useNightDim", () => {
  it("documents the clock window constants", () => {
    expect(NIGHT_DIM_START_HOUR).toBe(22);
    expect(NIGHT_DIM_END_HOUR).toBe(6);
  });

  it("dims at 23:00 when the board is all clear", () => {
    expect(run({ state: "all_clear", codeBlueActive: false, nowHours: 23 })).toBe(true);
  });

  it("dims across midnight (01:00) and at the 22:00 start edge", () => {
    expect(run({ state: "all_clear", codeBlueActive: false, nowHours: 1 })).toBe(true);
    expect(run({ state: "all_clear", codeBlueActive: false, nowHours: 22 })).toBe(true);
  });

  it("does NOT dim at 23:00 while the board state is alert", () => {
    expect(run({ state: "alert", codeBlueActive: false, nowHours: 23 })).toBe(false);
  });

  it("does NOT dim during an active Code Blue, regardless of board state", () => {
    expect(run({ state: "all_clear", codeBlueActive: true, nowHours: 23 })).toBe(false);
    expect(run({ state: null, codeBlueActive: true, nowHours: 2 })).toBe(false);
  });

  it("does not dim at 10:00 or at the 06:00 end edge", () => {
    expect(run({ state: "all_clear", codeBlueActive: false, nowHours: 10 })).toBe(false);
    expect(run({ state: "all_clear", codeBlueActive: false, nowHours: 6 })).toBe(false);
  });

  it("null state (no snapshot yet) still dims in-window — dim is chrome, not data", () => {
    expect(run({ state: null, codeBlueActive: false, nowHours: 23 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BoardShell wiring — data-night-dim attribute + always-on burn-in drift.
// BoardShell derives state/codeBlueActive READ-ONLY from the snapshot query
// cache (same pattern as useBoardAutoReload) — no prop-drilling, no poller.
// ---------------------------------------------------------------------------

function allClearSnapshot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currentTime: "23:00",
    currentShift: [],
    codeBlueSession: null,
    responsibles: null,
    commandBoard: {
      overview: { totalCritical: 2 },
      criticalUnits: [],
    },
    ...over,
  };
}

function renderShell(snapshotData: Record<string, unknown> | undefined) {
  const qc = new QueryClient();
  if (snapshotData !== undefined) {
    qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, snapshotData);
  }
  return render(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(BoardShell, null, createElement("div", { "data-testid": "board-content" })),
    ),
  );
}

describe("BoardShell night-dim + drift wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("applies data-night-dim at 23:00 with an all-clear cached snapshot", () => {
    vi.setSystemTime(new Date(2026, 7, 13, 23, 0, 0));
    const { container } = renderShell(allClearSnapshot());
    const shell = container.querySelector("[data-board-shell]");
    expect(shell?.hasAttribute("data-night-dim")).toBe(true);
  });

  it("does NOT apply data-night-dim during an active Code Blue at 23:00", () => {
    vi.setSystemTime(new Date(2026, 7, 13, 23, 0, 0));
    const { container } = renderShell(allClearSnapshot({ codeBlueSession: { id: "cb1" } }));
    const shell = container.querySelector("[data-board-shell]");
    expect(shell?.hasAttribute("data-night-dim")).toBe(false);
  });

  it("does NOT apply data-night-dim at 23:00 when a critical unit is down (alert)", () => {
    vi.setSystemTime(new Date(2026, 7, 13, 23, 0, 0));
    const { container } = renderShell(
      allClearSnapshot({
        commandBoard: {
          overview: { totalCritical: 2 },
          criticalUnits: [{ unitId: "u1", status: "maintenance" }],
        },
      }),
    );
    const shell = container.querySelector("[data-board-shell]");
    expect(shell?.hasAttribute("data-night-dim")).toBe(false);
  });

  it("does NOT apply data-night-dim at 10:00", () => {
    vi.setSystemTime(new Date(2026, 7, 13, 10, 0, 0));
    const { container } = renderShell(allClearSnapshot());
    const shell = container.querySelector("[data-board-shell]");
    expect(shell?.hasAttribute("data-night-dim")).toBe(false);
  });

  it("always wraps content in the burn-in drift wrapper (day or night)", () => {
    vi.setSystemTime(new Date(2026, 7, 13, 10, 0, 0));
    const { container, getByTestId } = renderShell(allClearSnapshot());
    const drift = container.querySelector(".board-drift");
    expect(drift).not.toBeNull();
    expect(drift?.contains(getByTestId("board-content"))).toBe(true);
  });
});
