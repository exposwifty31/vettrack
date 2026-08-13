import { useMemo } from "react";
import { useSearch } from "wouter";

/**
 * Single source of truth for the `?tv=1` URL contract that opts the Command
 * Center board into its 10-foot / TV-navigable presentation (mirror of
 * use-kiosk-mode-from-url.ts). It is ORTHOGONAL to kiosk mode: `?kiosk=1` hides
 * the exit button + drives the operational heartbeat, `?tv=1` switches on the
 * big-screen type scale, overscan-safe framing, and the D-pad focus layer. A
 * wall-mounted TV display typically sets BOTH; either can be set alone.
 *
 * Reactive to query-only navigation: subscribes to wouter's search string so a
 * `?tv=1` → no-query (or reverse) transition recomputes while `/board` stays
 * mounted. SSR-safe; returns false when there is no window.
 * Read by BoardShell (overscan-safe framing) and CommandBoardScreen (presentation)
 * independently — both call this hook rather than threading a prop through routes.
 */
export function useTvModeFromUrl(): boolean {
  const search = useSearch();
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(search).get("tv") === "1";
  }, [search]);
}
