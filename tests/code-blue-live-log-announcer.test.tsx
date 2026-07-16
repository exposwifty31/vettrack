/**
 * @vitest-environment happy-dom
 *
 * R-CBF-1.3 (pre-PR panel #3) — LiveLogAnnouncer must NOT announce pre-existing
 * log entries as "new" when it mounts into an ALREADY-ACTIVE Code Blue (a user
 * re-entering a running event whose timeline already holds N rows, e.g. via the
 * cached session). The batched announcer's baseline must seed to the mount-time
 * entry count, so only entries that arrive AFTER mount are announced to
 * screen-reader users. Seeding the baseline to 0 announces the whole history as
 * "N new log entries" mid-emergency — a real a11y harm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { LiveLogAnnouncer } from "@/features/code-blue/LiveLogAnnouncer";

vi.mock("@/lib/i18n", () => ({
  t: { codeBlue: { hold: { newLogEntries: (n: number) => `${n} new log entries` } } },
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const entry = (id: string) => ({ id, label: `entry ${id}` });

describe("LiveLogAnnouncer · mount baseline (panel #3)", () => {
  it("does NOT announce pre-existing entries when mounted mid-session with history", () => {
    const { getByTestId } = render(
      <LiveLogAnnouncer entries={[entry("a"), entry("b")]} throttleMs={1500} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // With the baseline bug this reads "2 new log entries".
    expect(getByTestId("cb-live-log-announcer").textContent).toBe("");
  });

  it("announces only entries added AFTER mount", () => {
    const { getByTestId, rerender } = render(
      <LiveLogAnnouncer entries={[entry("a"), entry("b")]} throttleMs={1500} />,
    );
    rerender(
      <LiveLogAnnouncer entries={[entry("a"), entry("b"), entry("c")]} throttleMs={1500} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // With the baseline bug this reads "3 new log entries".
    expect(getByTestId("cb-live-log-announcer").textContent).toBe("1 new log entries");
  });
});
