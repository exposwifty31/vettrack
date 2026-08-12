import { useMemo } from "react";

/**
 * Single source of truth for the `?tv=1` URL contract that opts the Command
 * Center board into its 10-foot / TV-navigable presentation (mirror of
 * use-kiosk-mode-from-url.ts). It is ORTHOGONAL to kiosk mode: `?kiosk=1` hides
 * the exit button + drives the operational heartbeat, `?tv=1` switches on the
 * big-screen type scale, overscan-safe framing, and the D-pad focus layer. A
 * wall-mounted TV display typically sets BOTH; either can be set alone.
 *
 * SSR-safe; returns false when there is no window or the URL can't be parsed.
 * Read by BoardShell (overscan-safe framing) and CommandBoardScreen (presentation)
 * independently — both call this hook rather than threading a prop through routes.
 */
export function useTvModeFromUrl(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URL(window.location.href).searchParams.get("tv") === "1";
    } catch (err) {
      // window.location.href is normally a well-formed URL; log if it ever isn't,
      // then fall back to non-TV rather than swallowing it silently.
      console.warn("[board] failed to parse ?tv from the URL; defaulting to non-TV", err);
      return false;
    }
  }, []);
}
