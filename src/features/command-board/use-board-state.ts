import { useEffect, useRef, useState } from "react";
import { classifyBoardState, type BoardStateInput, type BoardStateKind } from "./board-state";

/** Exit-only hysteresis window — "alert" is held this long after the trigger clears. */
export const ALERT_EXIT_HOLD_MS = 30_000;

/**
 * Board state with exit-only hysteresis on "alert" (same doctrine as the old
 * useBoardMode pressure hold): enter "alert" on the very render the classifier
 * says so; leave it only after ALERT_EXIT_HOLD_MS of continuously-non-alert
 * classification. A re-alert inside the window cancels the pending exit and the
 * next clear restarts the full hold — flapping equipment never strobes the wall.
 *
 * The takeover states bypass the hold entirely: "stale"/"unconfigured" win
 * instantly even out of a held alert, because a dead feed or a configuration
 * hole must never be masked by a stale alert card.
 */
export function useBoardState(input: BoardStateInput): BoardStateKind {
  const raw = classifyBoardState(input);
  const isAlert = raw === "alert";

  const [alertHeld, setAlertHeld] = useState(isAlert);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isAlert) {
      // Enter immediately; cancel any pending exit.
      if (exitTimer.current !== null) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setAlertHeld(true);
      return;
    }
    // Trigger cleared → schedule the exit; a re-alert cancels it via cleanup.
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      setAlertHeld(false);
    }, ALERT_EXIT_HOLD_MS);
    return () => {
      if (exitTimer.current !== null) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [isAlert]);

  // Takeovers are never held back — they outrank the alert hold.
  if (raw === "stale" || raw === "unconfigured") return raw;
  if (isAlert) return "alert";
  return alertHeld ? "alert" : raw;
}
