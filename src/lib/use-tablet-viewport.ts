import { useEffect, useState } from "react";

/**
 * Single source of truth for the "is this a tablet-class viewport" decision.
 *
 * This one predicate forks two surfaces that MUST agree:
 *   - the app shell — sidebar (tablet) vs bottom tab bar (phone) in NativeShell
 *   - the scan affordance — floating FAB (tablet) vs flat scan tab (phone)
 * Previously each of NativeShell, MoreSheet, and scan-affordance hand-rolled its
 * own `matchMedia("(min-width: 768px)")` hook; if one drifted, the shell and the
 * scan control could disagree about the device class.
 *
 * A viewport is tablet-class when BOTH dimensions clear their threshold:
 *   - width  ≥ 768  (the established tablet width)
 *   - height ≥ 500
 *
 * The min-height guard keeps a large phone in LANDSCAPE on the phone shell.
 * A phone's shorter side never reaches 500px (an iPhone Pro Max is ~430pt wide,
 * so ~430pt tall in landscape), while the smallest tablet's shorter side is
 * ~744pt (iPad mini). 500 sits in that empty gap, so it separates the two
 * classes in either orientation — landscape phones drop to the phone shell
 * without reclassifying any iPad (mini included). Only large phones in
 * landscape change behavior versus the previous width-only check.
 */
export const TABLET_MIN_WIDTH = 768;
export const TABLET_MIN_HEIGHT = 500;
export const TABLET_MEDIA_QUERY = `(min-width: ${TABLET_MIN_WIDTH}px) and (min-height: ${TABLET_MIN_HEIGHT}px)`;

/** Pure predicate — a viewport of these dimensions is tablet-class. */
export function isTabletViewport(width: number, height: number): boolean {
  return width >= TABLET_MIN_WIDTH && height >= TABLET_MIN_HEIGHT;
}

/** SSR-safe snapshot of the current viewport class. */
export function matchesTabletViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(TABLET_MEDIA_QUERY).matches;
}

/** Reactive hook — re-renders when the viewport crosses the tablet boundary (rotate/resize). */
export function useIsTabletViewport(): boolean {
  const [isTablet, setIsTablet] = useState<boolean>(matchesTabletViewport);

  useEffect(() => {
    const mq = window.matchMedia(TABLET_MEDIA_QUERY);
    const handler = () => setIsTablet(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isTablet;
}
