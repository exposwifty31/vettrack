import { useEffect, useRef, type RefObject } from "react";

type Options = {
  /** Trap is live only while this is true (e.g. the overlay is open). */
  active: boolean;
  /** The modal container whose focusable descendants Tab should cycle within. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called when Escape is pressed — typically closes the overlay. */
  onEscape: () => void;
};

/**
 * Keyboard support for a modal overlay: Escape closes it and Tab is trapped
 * within `containerRef` so focus can't land on the page behind it. Shared by the
 * equipment search overlay and the settings MoreSheet so both stay consistent.
 *
 * Initial focus is intentionally left to the caller (each overlay focuses a
 * different first element), and `onEscape` is read through a ref so passing an
 * inline callback doesn't re-subscribe the listener every render.
 */
export function useFocusTrap({ active, containerRef, onEscape }: Options): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = containerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, containerRef]);
}
