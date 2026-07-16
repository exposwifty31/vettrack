/**
 * @vitest-environment happy-dom
 *
 * R-CBF-1.3 — client arm→hold-to-confirm (the safe "one tap").
 *
 * "One tap" literally is an accidental-Code-Blue generator (phone in a scrub
 * pocket). The pinned resolution (Apple Emergency-SOS precedent): tap = ARM
 * (a full-screen unswipeable armed screen) → COMMIT = an exactly-800ms
 * press-and-hold with an escalating haptic ramp (`warning()`→`locked()`) and a
 * filling ring, always-visible Cancel.
 *
 * Every a11y + hold-boundary assertion here is executable (guardrail: emergency
 * flow — no gesture-only or hover-only affordance):
 *  - a single tap does NOT start; a completed 800ms hold does (ONE token)
 *  - the 800ms boundary is exact (799ms → no fire, 800ms → fire)
 *  - Cancel dismisses without starting
 *  - the control is operable by keyboard / switch activation (not pointer-only)
 *  - focus enters the armed control on open, returns to the trigger on cancel
 *  - the haptic ramp is warning() on arm → locked() on commit
 *  - ≥56px targets; reduced-motion fallback for the ring
 *  - live-log aria-live announcements are throttled/batched (not one-per-entry)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { t } from "@/lib/i18n";

vi.mock("@/lib/haptics", () => ({
  haptics: { warning: vi.fn(), locked: vi.fn(), tap: vi.fn(), error: vi.fn() },
}));
import { haptics } from "@/lib/haptics";
import { HoldToStart } from "@/features/code-blue/HoldToStart";
import { LiveLogAnnouncer } from "@/features/code-blue/LiveLogAnnouncer";

const HOLD_MS = 800;

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderControl(
  props: Partial<React.ComponentProps<typeof HoldToStart>> = {},
) {
  const onCommit = props.onCommit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  render(<HoldToStart {...props} onCommit={onCommit} onCancel={onCancel} />);
  const hold = screen.getByRole("button", { name: t.codeBlue.hold.instruction });
  return { onCommit, onCancel, hold };
}

describe("HoldToStart — arm→hold-to-confirm (R-CBF-1.3)", () => {
  beforeEach(() => {
    setReducedMotion(false);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("a single tap (press+immediate release) does NOT start a session", () => {
    const { onCommit, hold } = renderControl();
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold);
    act(() => vi.advanceTimersByTime(2000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a completed 800ms hold starts exactly one session with one non-empty token", () => {
    const { onCommit, hold } = renderControl();
    fireEvent.pointerDown(hold);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const token = onCommit.mock.calls[0][0];
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("the 800ms boundary is exact: 799ms release does NOT fire", () => {
    const { onCommit, hold } = renderControl();
    fireEvent.pointerDown(hold);
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    fireEvent.pointerUp(hold);
    act(() => vi.advanceTimersByTime(2000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("the 800ms boundary is exact: reaching 800ms fires", () => {
    const { onCommit, hold } = renderControl();
    fireEvent.pointerDown(hold);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Cancel dismisses without starting", () => {
    const { onCommit, onCancel } = renderControl();
    const cancel = screen.getByRole("button", { name: t.codeBlue.hold.cancel });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("is operable by keyboard / switch activation (Space hold), not pointer-only", () => {
    const { onCommit, hold } = renderControl();
    act(() => hold.focus());
    fireEvent.keyDown(hold, { key: " " });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("a keyboard release before 800ms does NOT fire", () => {
    const { onCommit, hold } = renderControl();
    act(() => hold.focus());
    fireEvent.keyDown(hold, { key: " " });
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    fireEvent.keyUp(hold, { key: " " });
    act(() => vi.advanceTimersByTime(2000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("focus enters the armed control on open and returns to the trigger on cancel", () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const onCancel = vi.fn();
    render(
      <>
        <button ref={triggerRef} type="button">
          arm
        </button>
        <HoldToStart onCommit={vi.fn()} onCancel={onCancel} triggerRef={triggerRef} />
      </>,
    );
    const hold = screen.getByRole("button", { name: t.codeBlue.hold.instruction });
    expect(document.activeElement).toBe(hold);

    fireEvent.click(screen.getByRole("button", { name: t.codeBlue.hold.cancel }));
    expect(document.activeElement).toBe(triggerRef.current);
  });

  it("ramps the haptics: warning() on arm, locked() on commit", () => {
    const { hold } = renderControl();
    fireEvent.pointerDown(hold);
    expect(haptics.warning).toHaveBeenCalledTimes(1);
    expect(haptics.locked).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(haptics.locked).toHaveBeenCalledTimes(1);
  });

  it("hold and cancel controls meet the ≥56px touch-target floor", () => {
    const { hold } = renderControl();
    const cancel = screen.getByRole("button", { name: t.codeBlue.hold.cancel });
    for (const el of [hold, cancel]) {
      expect(parseInt(el.style.minHeight, 10)).toBeGreaterThanOrEqual(56);
      expect(parseInt(el.style.minWidth, 10)).toBeGreaterThanOrEqual(56);
    }
  });

  it("exposes a reduced-motion fallback for the filling ring", () => {
    setReducedMotion(true);
    renderControl();
    const ring = screen.getByTestId("cb-hold-ring");
    expect(ring.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("does not arm when display-only (iPad / board render server-confirmed sessions)", () => {
    const { onCommit, hold } = renderControl({ disabled: true });
    fireEvent.pointerDown(hold);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onCommit).not.toHaveBeenCalled();
    expect((hold as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("LiveLogAnnouncer — throttled/batched aria-live (R-CBF-1.3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("batches a burst of entries into ONE announcement (not one-per-entry)", () => {
    const throttleMs = 1000;
    const { rerender } = render(<LiveLogAnnouncer entries={[]} throttleMs={throttleMs} />);
    const region = screen.getByTestId("cb-live-log-announcer");
    expect(region.getAttribute("aria-live")).toBe("polite");

    // Three entries added within one throttle window.
    rerender(<LiveLogAnnouncer entries={[{ id: "a", label: "epi" }]} throttleMs={throttleMs} />);
    rerender(
      <LiveLogAnnouncer
        entries={[
          { id: "a", label: "epi" },
          { id: "b", label: "atropine" },
        ]}
        throttleMs={throttleMs}
      />,
    );
    rerender(
      <LiveLogAnnouncer
        entries={[
          { id: "a", label: "epi" },
          { id: "b", label: "atropine" },
          { id: "c", label: "compressions" },
        ]}
        throttleMs={throttleMs}
      />,
    );

    // Nothing announced synchronously per entry (throttle window not elapsed).
    expect(region.textContent).toBe("");

    // One batched announcement after the throttle window.
    act(() => vi.advanceTimersByTime(throttleMs));
    expect(region.textContent).toBe(t.codeBlue.hold.newLogEntries(3));
  });
});
