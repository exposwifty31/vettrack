/**
 * @vitest-environment happy-dom
 *
 * The shared modal keyboard behavior backing the equipment search overlay and
 * the settings MoreSheet: Escape closes, Tab is trapped within the container.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

function Modal({ active = true, onEscape }: { active?: boolean; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap({ active, containerRef: ref, onEscape });
  return (
    <div ref={ref}>
      <button>first</button>
      <button>last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  afterEach(() => cleanup());

  it("calls onEscape when Escape is pressed", () => {
    const onEscape = vi.fn();
    render(<Modal onEscape={onEscape} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last focusable back to the first", () => {
    render(<Modal onEscape={vi.fn()} />);
    const [first, last] = screen.getAllByRole("button");
    last!.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last!, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    render(<Modal onEscape={vi.fn()} />);
    const [first, last] = screen.getAllByRole("button");
    first!.focus();
    fireEvent.keyDown(first!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does nothing while inactive", () => {
    const onEscape = vi.fn();
    render(<Modal active={false} onEscape={onEscape} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});
