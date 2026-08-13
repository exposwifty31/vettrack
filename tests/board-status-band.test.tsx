/**
 * @vitest-environment happy-dom
 *
 * Task 8 — top band, tinted state strip, freshness chip + heartbeat.
 * The band is the board's always-on anchor: department identity, ready/total
 * summary, coarse-bucket freshness (never a live-ticking timestamp), and the
 * clock. Invariants under test: LTR isolation (<bdi dir="ltr">) for clock and
 * ready/total inside an RTL layout; absent counts render the muted-unavailable
 * copy, never "0/0" (absent ≠ zero); heartbeat re-keys per successful poll;
 * freshness stays in coarse buckets (<10 s / <60 s / minutes, floored).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  BoardTopBand,
  BoardStateStrip,
  FreshnessChip,
  formatFreshness,
} from "@/features/command-board/components/board-status-band";
import { t } from "@/lib/i18n";
import type { DisplayConnection } from "@/hooks/use-display-connection";
import type { BoardStateKind } from "@/features/command-board/board-state";

const NOW = 1_755_072_000_000;

function conn(over: Partial<DisplayConnection> = {}): DisplayConnection {
  return { state: "live", lastSuccessAt: NOW - 3_000, missedPolls: 0, ...over };
}

afterEach(() => cleanup());

describe("formatFreshness coarse buckets", () => {
  it("under 10s is 'now'", () => {
    expect(formatFreshness(NOW - 0, NOW)).toEqual({ key: "now" });
    expect(formatFreshness(NOW - 9_999, NOW)).toEqual({ key: "now" });
  });

  it("10s..59s is 'underMinute'", () => {
    expect(formatFreshness(NOW - 10_000, NOW)).toEqual({ key: "underMinute" });
    expect(formatFreshness(NOW - 59_999, NOW)).toEqual({ key: "underMinute" });
  });

  it("60s+ is floored whole minutes", () => {
    expect(formatFreshness(NOW - 60_000, NOW)).toEqual({ key: "minutes", minutes: 1 });
    expect(formatFreshness(NOW - 150_000, NOW)).toEqual({ key: "minutes", minutes: 2 });
    expect(formatFreshness(NOW - 3_599_000, NOW)).toEqual({ key: "minutes", minutes: 59 });
  });
});

describe("FreshnessChip", () => {
  it("renders the bucket copy for a fresh poll", () => {
    render(<FreshnessChip connection={conn()} nowMs={NOW} />);
    expect(screen.getByText(t.board.freshnessNow)).toBeTruthy();
  });

  it("renders minute-bucket copy at minute granularity", () => {
    render(<FreshnessChip connection={conn({ lastSuccessAt: NOW - 150_000 })} nowMs={NOW} />);
    expect(screen.getByText(t.board.freshnessMinutes(2))).toBeTruthy();
  });

  it("no successful poll yet renders the updating copy, not a fake freshness", () => {
    render(<FreshnessChip connection={conn({ lastSuccessAt: null })} nowMs={NOW} />);
    expect(screen.getByText(t.board.updatingNow)).toBeTruthy();
  });

  it("heartbeat dot re-keys on lastSuccessAt change (data-beat tracks the poll)", () => {
    const { rerender } = render(<FreshnessChip connection={conn({ lastSuccessAt: NOW - 5_000 })} nowMs={NOW} />);
    const beat = screen.getByTestId("board-heartbeat");
    expect(beat.getAttribute("data-beat")).toBe(String(NOW - 5_000));
    rerender(<FreshnessChip connection={conn({ lastSuccessAt: NOW })} nowMs={NOW + 1} />);
    expect(screen.getByTestId("board-heartbeat").getAttribute("data-beat")).toBe(String(NOW));
  });

  it("carries data-connection for degraded styling", () => {
    render(<FreshnessChip connection={conn({ state: "delayed", missedPolls: 5 })} nowMs={NOW} />);
    expect(screen.getByTestId("board-freshness-chip").getAttribute("data-connection")).toBe("delayed");
  });
});

describe("BoardStateStrip", () => {
  const states: BoardStateKind[] = ["stale", "unconfigured", "alert", "attention", "all_clear"];
  it("sets data-state for every board state (drives the tint)", () => {
    for (const state of states) {
      const { unmount } = render(<BoardStateStrip state={state} />);
      expect(screen.getByTestId("board-state-strip").getAttribute("data-state")).toBe(state);
      unmount();
    }
  });
});

describe("BoardTopBand", () => {
  const baseProps = {
    departmentLabel: "ICU",
    readyCount: 12,
    totalCount: 12,
    currentTime: "2026-08-13T10:18:45", // local time — seconds must NOT render
    connection: conn(),
  };

  it("renders the clock without seconds inside an LTR-isolated bdi", () => {
    render(<BoardTopBand {...baseProps} />);
    const clock = screen.getByTestId("board-clock");
    const bdi = clock.querySelector("bdi");
    expect(bdi).toBeTruthy();
    expect(bdi!.getAttribute("dir")).toBe("ltr");
    expect(bdi!.textContent).toBe("10:18");
  });

  it("renders ready/total as an LTR-isolated 12/12", () => {
    render(<BoardTopBand {...baseProps} />);
    const summary = screen.getByTestId("board-ready-summary");
    const bdi = summary.querySelector("bdi");
    expect(bdi).toBeTruthy();
    expect(bdi!.getAttribute("dir")).toBe("ltr");
    expect(bdi!.textContent).toBe("12/12");
  });

  it("null counts (board absent) render the unavailable copy, never 0/0", () => {
    render(<BoardTopBand {...baseProps} readyCount={null} totalCount={null} />);
    const summary = screen.getByTestId("board-ready-summary");
    expect(summary.textContent).toBe(t.board.blockUnavailable);
    expect(summary.textContent).not.toContain("0/0");
    expect(summary.querySelector("bdi")).toBeNull();
  });

  it("renders department label and mounts the freshness heartbeat", () => {
    render(<BoardTopBand {...baseProps} />);
    expect(screen.getByText("ICU")).toBeTruthy();
    expect(screen.getByTestId("board-heartbeat")).toBeTruthy();
  });
});
