import { useEffect, useState } from "react";
import type { BoardStateKind } from "@/features/command-board/board-state";

/**
 * Kiosk night-dim window — CLIENT clock constants, deliberately documented here:
 * Phase 1 has no server-side schedule source, so the wall dims on the display
 * device's local time. Change the window by editing these two constants (see
 * docs/runbooks/board-kiosk.md).
 */
export const NIGHT_DIM_START_HOUR = 22;
export const NIGHT_DIM_END_HOUR = 6;

/** Re-read the wall clock once a minute — dim granularity is the hour. */
const CLOCK_CHECK_INTERVAL_MS = 60_000;

function isNightWindow(hours: number): boolean {
  // Window crosses midnight: [22:00, 24:00) ∪ [00:00, 06:00).
  return hours >= NIGHT_DIM_START_HOUR || hours < NIGHT_DIM_END_HOUR;
}

/**
 * Whether the kiosk should apply the night-dim treatment. Two unconditional
 * overrides — an `alert` board state and an active Code Blue always run at
 * full brightness. `state: null` (no snapshot cached yet) still dims in-window:
 * the dim is display chrome, not a data statement.
 */
export function useNightDim(opts: {
  state: BoardStateKind | null;
  codeBlueActive: boolean;
  nowHours?: number;
}): boolean {
  const { state, codeBlueActive, nowHours } = opts;
  const [clockHours, setClockHours] = useState(() => new Date().getHours());

  useEffect(() => {
    if (nowHours !== undefined) return;
    const id = setInterval(() => setClockHours(new Date().getHours()), CLOCK_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [nowHours]);

  if (codeBlueActive) return false;
  if (state === "alert") return false;
  return isNightWindow(nowHours ?? clockHours);
}
