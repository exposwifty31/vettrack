/**
 * Pure time-window helpers for shift-adjustment requests (Phase 1).
 *
 * Shift end times are stored as clock-time (`HH:MM:SS`) with no date, so an
 * overnight shift has an end numerically *smaller* than its start. To compare
 * "later" vs. "earlier" correctly across midnight, end candidates at or before
 * the start clock-time are projected onto the following day (+24h). This mirrors
 * the overnight window logic in `role-resolution.ts`.
 *
 * Extracted from the route so the direction math is unit-testable without a DB,
 * and reusable by the role-resolution authority wiring (which computes the
 * effective end from an approved adjustment using the same frame).
 */

export type ShiftAdjustmentKind = "extend" | "leave_early";

const MINUTES_PER_DAY = 1440;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Normalize `H:MM` / `HH:MM` / `HH:MM:SS` to a `HH:MM:SS` literal, or null if invalid. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Minutes for a shift *end* candidate within the shift frame: any time at or
 * before the start clock-time is treated as the following day (+24h), so
 * "later" / "earlier" comparisons stay correct across an overnight boundary.
 */
export function endAbsMinutes(startMins: number, endMins: number): number {
  return endMins <= startMins ? endMins + MINUTES_PER_DAY : endMins;
}

/**
 * True when `now` falls inside a shift `[start, end)` window on `shiftDate`.
 * Overnight shifts (end clock-time at/before start) roll the end onto the next
 * calendar day. Times are interpreted in the server's local zone — the same
 * frame `role-resolution.ts` uses for its roster window match. `end` may be an
 * adjusted effective end (extended later or shortened earlier).
 */
export function shiftWindowContains(
  now: Date,
  shiftDate: string,
  startTime: string,
  endTime: string,
): boolean {
  const [year, month, day] = shiftDate.split("-").map(Number);
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const overnight = timeToMinutes(endTime) <= timeToMinutes(startTime);
  const start = new Date(year, month - 1, day, sh, sm, 0, 0);
  const end = new Date(year, month - 1, day + (overnight ? 1 : 0), eh, em, 0, 0);
  return now >= start && now < end;
}

export type DirectionReason = "NOT_AN_EXTENSION" | "NOT_EARLIER";
export type DirectionCheck = { ok: true } | { ok: false; reason: DirectionReason };

/**
 * Validate that `requestedEndTime` moves the shift end in the direction `kind`
 * implies: `extend` must end strictly later, `leave_early` strictly earlier.
 */
export function checkAdjustmentDirection(
  kind: ShiftAdjustmentKind,
  startTime: string,
  currentEndTime: string,
  requestedEndTime: string,
): DirectionCheck {
  const startMins = timeToMinutes(startTime);
  const currentEndAbs = endAbsMinutes(startMins, timeToMinutes(currentEndTime));
  const requestedEndAbs = endAbsMinutes(startMins, timeToMinutes(requestedEndTime));
  if (kind === "extend" && requestedEndAbs <= currentEndAbs) {
    return { ok: false, reason: "NOT_AN_EXTENSION" };
  }
  if (kind === "leave_early" && requestedEndAbs >= currentEndAbs) {
    return { ok: false, reason: "NOT_EARLIER" };
  }
  return { ok: true };
}
