import { useMemo } from "react";

/**
 * Single source of truth for the `?kiosk=1` URL contract used by the Command
 * Center board surfaces (WardDisplayPage wrapper, CommandBoardScreen, and the
 * presentational CommandBoard). SSR-safe; returns false when there is no window
 * or the URL can't be parsed. Callers that also accept an explicit kioskMode
 * prop should coalesce it OVER this value, e.g. `prop ?? useKioskModeFromUrl()`
 * — but call the hook unconditionally (see the two-line form at call sites).
 */
export function useKioskModeFromUrl(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URL(window.location.href).searchParams.get("kiosk") === "1";
    } catch {
      return false;
    }
  }, []);
}
