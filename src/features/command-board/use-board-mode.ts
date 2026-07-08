import { useEffect, useRef, useState } from "react";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

export type BoardMode = "calm" | "pressure";

/** Critical-alert count that flips calm→pressure when there is no active emergency. */
export const PRESSURE_ALERT_THRESHOLD = 3;

/** Exit-only hysteresis window — pressure is held this long after the trigger clears. */
export const PRESSURE_EXIT_HOLD_MS = 30_000;

/**
 * Single source of truth for "how many critical alerts are on the board" — used
 * both by the pressure-threshold decision here and by the calm-mode alert count in
 * CommandBoard, so the two never drift on what counts as critical.
 */
export function countCriticalAlerts(board: EquipmentCommandBoardSnapshot): number {
  return board.alerts.filter((a) => a.severity === "critical").length;
}

/**
 * Derives the board's display mode from the ALREADY-polled snapshot (props) — no
 * new poller, no SSE, nothing persisted. Pressure when an emergency is active OR
 * critical alerts reach the threshold.
 *
 * Hysteresis is deliberately EXIT-ONLY (emergency doctrine): enter pressure on the
 * very render the trigger goes true; leave pressure only after it stays false for a
 * continuous PRESSURE_EXIT_HOLD_MS. A re-trigger within the window cancels the
 * pending exit. This is a layout-emphasis machine only — a real Code Blue is
 * handled server-side by CommandBoardScreen's overlay early return, above this.
 */
export function useBoardMode(board: EquipmentCommandBoardSnapshot): BoardMode {
  const criticalAlerts = countCriticalAlerts(board);
  const rawPressure = board.activeEmergency != null || criticalAlerts >= PRESSURE_ALERT_THRESHOLD;

  const [mode, setMode] = useState<BoardMode>(rawPressure ? "pressure" : "calm");
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (rawPressure) {
      // Enter immediately; cancel any pending exit.
      if (exitTimer.current !== null) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setMode("pressure");
      return;
    }
    // Trigger cleared → schedule the exit to calm; a re-trigger cancels it via cleanup.
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      setMode("calm");
    }, PRESSURE_EXIT_HOLD_MS);
    return () => {
      if (exitTimer.current !== null) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [rawPressure]);

  return mode;
}
