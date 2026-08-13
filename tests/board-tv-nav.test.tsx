/**
 * @vitest-environment happy-dom
 *
 * D-pad / TV-remote nav layer (`useBoardTvNav`, PR #178) — the window keydown
 * guards and the focus-restoration contract raised in review:
 *   1. Arrow keys inside an editable field (input/textarea/select) are ignored —
 *      the caret keeps working, the D-pad does not steal the event.
 *   2. Escape originating inside an open dialog is ignored — the dialog owns the
 *      press; the board exit control must not be clicked in the same keystroke.
 *   3. Engaging nav on a target WITHOUT `data-tv-id` must not overwrite the
 *      remembered id with null — focus restoration after a reconcile (node
 *      unmount) stays alive and re-homes to a surviving/initial anchor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useBoardTvNav } from "@/features/command-board/use-board-tv-nav";

interface HarnessProps {
  showNoIdTarget?: boolean;
  showDialog?: boolean;
  onExit?: () => void;
}

function Harness({ showNoIdTarget = true, showDialog = false, onExit }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useBoardTvNav({ enabled: true, containerRef: ref, reducedMotion: true });
  return (
    <>
      <div ref={ref}>
        <div data-tv-focusable="" data-tv-id="a" data-tv-focus-initial="" data-testid="a" />
        {showNoIdTarget && <div data-tv-focusable="" data-testid="no-id" />}
        <input data-testid="field" />
        <button type="button" data-testid="board-exit" onClick={onExit}>
          exit
        </button>
      </div>
      {showDialog && (
        <div role="dialog" data-testid="dialog">
          <button type="button" data-testid="dialog-button">
            ok
          </button>
        </div>
      )}
    </>
  );
}

/** Stacked vertical rects so ArrowDown moves a → no-id; everything else off-axis. */
const RECTS: Record<string, { top: number; height: number }> = {
  a: { top: 0, height: 10 },
  "no-id": { top: 20, height: 10 },
  field: { top: 40, height: 10 },
  "board-exit": { top: 60, height: 10 },
  dialog: { top: 80, height: 10 },
  "dialog-button": { top: 80, height: 10 },
};

// vi.restoreAllMocks() only restores vi.spyOn spies — a direct prototype
// assignment must be reverted by hand, so keep the original descriptor.
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const key = this.getAttribute("data-testid") ?? "";
    const r = RECTS[key] ?? { top: 0, height: 0 };
    return {
      x: 0,
      y: r.top,
      top: r.top,
      bottom: r.top + r.height,
      left: 0,
      right: r.height > 0 ? 100 : 0,
      width: r.height > 0 ? 100 : 0,
      height: r.height,
      toJSON: () => ({}),
    };
  });
  // happy-dom has no scrollIntoView; reveal() calls it on every focus move.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  }
});

describe("useBoardTvNav keydown guards", () => {
  it("ignores arrow keys originating inside an editable field", () => {
    const { getByTestId } = render(<Harness />);
    const field = getByTestId("field");
    field.focus();

    // fireEvent returns false when preventDefault() was called by a handler.
    const notPrevented = fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it("ignores Escape originating inside an open dialog (exit is NOT clicked)", () => {
    const onExit = vi.fn();
    const { getByTestId } = render(<Harness showDialog onExit={onExit} />);

    fireEvent.keyDown(getByTestId("dialog-button"), { key: "Escape" });

    expect(onExit).not.toHaveBeenCalled();
  });

  it("routes Escape from outside any dialog to the exit control", () => {
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("useBoardTvNav focus restoration", () => {
  it("keeps restoration alive after focusing a target without data-tv-id", () => {
    const { getByTestId, rerender } = render(<Harness />);
    const a = getByTestId("a");
    const noId = getByTestId("no-id");

    // Engage nav: first press homes to the initial anchor, second moves down to
    // the id-less target.
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(document.activeElement).toBe(noId);

    // Reconcile unmounts the focused node → focus falls to <body>. Restoration
    // must re-home to the surviving anchor instead of going dead (the null
    // overwrite regression would leave focus on <body>).
    rerender(<Harness showNoIdTarget={false} />);
    expect(document.activeElement).toBe(a);
  });
});
