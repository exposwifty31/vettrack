import { useEffect, useRef, type RefObject } from "react";

/**
 * Web spatial-navigation (D-pad / TV-remote) layer for the Command Center board.
 *
 * WHY THIS EXISTS: a webOS / Tizen / Android-TV browser delivers remote presses as
 * plain arrow-key `keydown` events. This hook turns the otherwise passive glance
 * board into a NAVIGABLE 10-foot surface: Up/Down/Left/Right move focus between
 * board regions and rows by on-screen GEOMETRY, Enter activates a genuinely
 * interactive control, and Back maps to the existing exit affordance.
 *
 * ADDITIVE + DEGRADABLE, by contract:
 *   - Active only when `enabled` (the `?tv=1` board). Pointer + mouse still work;
 *     a remote-less board still glances fine.
 *   - Invents NO mutations. Focus targets opt in with `[data-tv-focusable]`; the
 *     only thing Enter can trigger is an already-interactive descendant (today:
 *     the exit button). Focusing a unit row reuses the board's EXISTING ephemeral
 *     co-presence `onFocus` selection — no new writes, honors Code Blue doctrine.
 *   - RTL-safe: arrows map to PHYSICAL screen direction (a remote's → always moves
 *     to the physically-right element), so nav is NOT mirrored for Hebrew.
 *
 * FOCUS RESTORATION is the hard part, not the geometry: the board re-renders on
 * every SSE/poll reconcile and swaps its entire `<main>` subtree on the
 * calm↔pressure switch. When the focused node unmounts, focus falls to <body> and
 * the D-pad goes dead. We remember the focused target by its stable `data-tv-id`
 * and re-home focus after every render — to the same id if it survived, else to a
 * stable anchor — so navigation never silently dies.
 */

const FOCUSABLE_SELECTOR = "[data-tv-focusable]";
const INITIAL_SELECTOR = "[data-tv-focus-initial]";
const ACTIONABLE_SELECTOR = "button, a[href], [role=\"button\"]";

// Slack (px) so a candidate that is only a hair off-axis still counts as being
// "in the direction" — keeps grid/row navigation from feeling stuck.
const OVERLAP_TOLERANCE = 8;
// Perpendicular drift is penalised this much harder than on-axis distance, so the
// D-pad prefers the element straight ahead over a nearer far-off diagonal.
const PERP_PENALTY = 3;

type Direction = "up" | "down" | "left" | "right";

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  // A nonzero rect is not enough: `visibility: hidden` (and `display: none` on an
  // ancestor mid-transition) keeps layout box dimensions while the element is not
  // actually visible — exclude those so the D-pad never lands on hidden targets.
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function inDirection(cur: DOMRect, cand: DOMRect, dir: Direction): boolean {
  switch (dir) {
    case "up":
      return cand.bottom <= cur.top + OVERLAP_TOLERANCE;
    case "down":
      return cand.top >= cur.bottom - OVERLAP_TOLERANCE;
    case "left":
      return cand.right <= cur.left + OVERLAP_TOLERANCE;
    case "right":
      return cand.left >= cur.right - OVERLAP_TOLERANCE;
  }
}

function directionalScore(cur: DOMRect, cand: DOMRect, dir: Direction): number {
  const curX = cur.left + cur.width / 2;
  const curY = cur.top + cur.height / 2;
  const candX = cand.left + cand.width / 2;
  const candY = cand.top + cand.height / 2;
  const dx = Math.abs(candX - curX);
  const dy = Math.abs(candY - curY);
  const along = dir === "up" || dir === "down" ? dy : dx;
  const perp = dir === "up" || dir === "down" ? dx : dy;
  return along + perp * PERP_PENALTY;
}

interface BoardTvNavOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement>;
  reducedMotion: boolean;
}

export function useBoardTvNav({ enabled, containerRef, reducedMotion }: BoardTvNavOptions): void {
  const lastFocusedId = useRef<string | null>(null);

  // Runs after EVERY render while enabled: (1) keep programmatic-focus tabindex in
  // sync as snapshot updates add/remove targets, (2) re-home focus if the previously
  // focused node was unmounted by a reconcile or the calm↔pressure swap. Cheap
  // (a querySelectorAll + contains check) and self-limiting — when focus is already
  // inside a target it does nothing, so co-presence onFocus can't loop it.
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const targets = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    for (const el of targets) {
      // A plain <div> reports `tabIndex === -1` yet is NOT programmatically
      // focusable until the tabindex ATTRIBUTE actually exists — so guard on the
      // attribute, not the IDL property (which is already -1 and would skip the
      // assignment, leaving every div region unfocusable). -1 = reachable via
      // .focus() (remote-driven), out of the Tab order.
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    }

    const active = document.activeElement;
    const focusInside =
      active instanceof HTMLElement && container.contains(active) && active.matches(FOCUSABLE_SELECTOR);
    if (focusInside) return;

    // Stay PASSIVE until the remote is actually used. Never grab focus on mount —
    // otherwise a remote-less wall board would light up the focus ring with zero
    // interaction (breaks "a remote-less board still glances fine"). Only RE-HOME
    // focus once nav has engaged (lastFocusedId set) and the focused node was
    // unmounted by a reconcile or the calm↔pressure <main> swap. The first arrow
    // press engages nav via move()'s no-current-focus branch. `null` means "never
    // engaged"; an empty string means "engaged on a target without a data-tv-id",
    // which must still re-home (to the initial anchor) after a reconcile.
    if (lastFocusedId.current === null) return;
    const survivor = targets.find((el) => el.getAttribute("data-tv-id") === lastFocusedId.current);
    const anchor = survivor ?? container.querySelector<HTMLElement>(INITIAL_SELECTOR) ?? targets[0] ?? null;
    anchor?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    function visibleTargets(scope: HTMLElement): HTMLElement[] {
      return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
    }

    function reveal(el: HTMLElement): void {
      // Keep the last known id when a target ships without `data-tv-id` (fall back
      // to the "" sentinel so restoration stays engaged and re-homes to the initial
      // anchor) — a null overwrite would silently disable focus restoration.
      lastFocusedId.current = el.getAttribute("data-tv-id") ?? lastFocusedId.current ?? "";
      // scrollIntoView is what makes long unit/location lists traversable by remote:
      // the focused item is pulled to the middle of its scroll container.
      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }

    function move(dir: Direction, scope: HTMLElement): void {
      const targets = visibleTargets(scope);
      if (targets.length === 0) return;
      const activeEl = document.activeElement;
      const active = activeEl instanceof HTMLElement ? activeEl : null;
      const current =
        active && scope.contains(active) && active.matches(FOCUSABLE_SELECTOR) ? active : null;
      if (!current) {
        const first = scope.querySelector<HTMLElement>(INITIAL_SELECTOR) ?? targets[0];
        first.focus({ preventScroll: true });
        reveal(first);
        return;
      }
      const curRect = current.getBoundingClientRect();
      let best: HTMLElement | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const cand of targets) {
        if (cand === current) continue;
        const candRect = cand.getBoundingClientRect();
        if (!inDirection(curRect, candRect, dir)) continue;
        const s = directionalScore(curRect, candRect, dir);
        if (s < bestScore) {
          bestScore = s;
          best = cand;
        }
      }
      if (best) {
        best.focus({ preventScroll: true });
        reveal(best);
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      const scope = containerRef.current;
      if (!scope) return;
      // A dialog or an editable control owns the key first: Radix closes on Escape
      // and text fields own arrow keys, so a window-level D-pad handler must not
      // double-handle them (caret would freeze; Escape would close the dialog AND
      // click the exit control in the same press).
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]') ||
          target.closest('[role="dialog"], [role="alertdialog"]'))
      ) {
        return;
      }
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          move("up", scope);
          break;
        case "ArrowDown":
          event.preventDefault();
          move("down", scope);
          break;
        case "ArrowLeft":
          event.preventDefault();
          move("left", scope);
          break;
        case "ArrowRight":
          event.preventDefault();
          move("right", scope);
          break;
        case "Enter": {
          const activeEl = document.activeElement;
          const active = activeEl instanceof HTMLElement ? activeEl : null;
          if (!active || !scope.contains(active) || !active.matches(FOCUSABLE_SELECTOR)) break;
          // Activate ONLY a genuinely-interactive control (today: the exit button).
          // Inert display regions are reachable for reading/reveal but do nothing —
          // the board invents no actions.
          const actionable = active.matches(ACTIONABLE_SELECTOR)
            ? active
            : active.querySelector<HTMLElement>(ACTIONABLE_SELECTOR);
          if (actionable) {
            event.preventDefault();
            actionable.click();
          }
          break;
        }
        // Back / Return on the various TV browsers → the EXISTING exit affordance.
        // A wall/kiosk board (?kiosk=1) has no exit button, so Back is a safe no-op.
        case "Escape":
        case "GoBack":
        case "BrowserBack": {
          const exit = scope.querySelector<HTMLElement>('[data-testid="board-exit"]');
          if (exit) {
            event.preventDefault();
            exit.click();
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, containerRef, reducedMotion]);
}
