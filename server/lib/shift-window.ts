/**
 * Pure roster shift-window helpers.
 *
 * A roster shift (`vt_shifts`) is a date + clock-time pair; these helpers turn
 * it into absolute instants and a deterministic "window session id" that chat
 * scoping uses in place of the orphaned `vt_shift_sessions` clock-in table.
 * Overnight shifts (end clock-time at or before start) end on the following
 * day — the same frame `shiftWindowContains` / role-resolution use.
 *
 * Kept free of db imports so unit tests never open a pool.
 */
import { timeToMinutes } from "./shift-adjustment-window.js";

export interface RosterWindowShift {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM[:SS]
  endTime: string; // HH:MM[:SS]
}

const WINDOW_SESSION_PREFIX = "win:";
const DATE_SEGMENT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Combine a roster `YYYY-MM-DD` date + `HH:MM[:SS]` time into a server-local instant. */
export function combineLocal(dateStr: string, timeStr: string, dayOffset: number): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = timeStr.split(":").map(Number);
  return new Date(year!, month! - 1, day! + dayOffset, hours, minutes, seconds);
}

/** Local-zone YYYY-MM-DD key for a Date — matches the roster's date column frame. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Absolute start/end instants of a roster shift window, overnight-aware. */
export function windowBounds(shift: RosterWindowShift): { startedAt: Date; endsAt: Date } {
  const overnight = timeToMinutes(shift.endTime) <= timeToMinutes(shift.startTime);
  return {
    startedAt: combineLocal(shift.date, shift.startTime, 0),
    endsAt: combineLocal(shift.date, shift.endTime, overnight ? 1 : 0),
  };
}

/** ISO-string window + role — the home-dashboard readout shape. */
export function buildShiftWindow(shift: RosterWindowShift & { role: string }): {
  startedAt: string;
  endsAt: string;
  role: string;
} {
  const { startedAt, endsAt } = windowBounds(shift);
  return { startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString(), role: shift.role };
}

/**
 * Deterministic synthetic session id for a roster window. Stable for every
 * poll inside the same window; changes when the window rolls over. Keyed on
 * the window's start only, so an approved end-time adjustment (extend /
 * leave_early) never swaps the conversation mid-shift.
 */
export function windowSessionId(
  clinicId: string,
  shift: Pick<RosterWindowShift, "date" | "startTime">,
): string {
  return `${WINDOW_SESSION_PREFIX}${clinicId}:${shift.date}:${shift.startTime}`;
}

export function isWindowSessionId(id: string): boolean {
  return id.startsWith(WINDOW_SESSION_PREFIX);
}

/**
 * Parse a synthetic window id back to its parts, or null for legacy
 * `vt_shift_sessions` ids. The clinic id may itself contain ":", so the date
 * segment is located from the end (time segments never match a date).
 */
export function parseWindowSessionId(
  id: string,
): { clinicId: string; date: string; startTime: string } | null {
  if (!isWindowSessionId(id)) return null;
  const parts = id.slice(WINDOW_SESSION_PREFIX.length).split(":");
  for (let i = parts.length - 2; i >= 1; i--) {
    if (DATE_SEGMENT_RE.test(parts[i]!)) {
      return {
        clinicId: parts.slice(0, i).join(":"),
        date: parts[i]!,
        startTime: parts.slice(i + 1).join(":"),
      };
    }
  }
  return null;
}
