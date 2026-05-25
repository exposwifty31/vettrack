/**
 * Equipment Recovery Layer — threshold constants and pure derivation helpers.
 * Client-side only; uses existing timestamps (no schema or server coupling).
 */

/** Max age since last confirm/seen still treated as recently confirmed. */
export const RECENTLY_CONFIRMED_MS = 4 * 60 * 60 * 1000;

/** Min age since last confirm/seen before {@link isEquipmentStale} is true. */
export const STALE_MS = 24 * 60 * 60 * 1000;

/** Min age since last confirm/seen for {@link EquipmentStalenessLevel} `very_stale`. */
export const VERY_STALE_MS = 72 * 60 * 60 * 1000;

/** Min checkout duration before equipment is considered checked out too long. */
export const CHECKED_OUT_TOO_LONG_MS = 48 * 60 * 60 * 1000;

export const EQUIPMENT_RECOVERY_THRESHOLDS = {
  recentlyConfirmedMs: RECENTLY_CONFIRMED_MS,
  staleMs: STALE_MS,
  veryStaleMs: VERY_STALE_MS,
  checkedOutTooLongMs: CHECKED_OUT_TOO_LONG_MS,
} as const;

export type EquipmentStalenessLevel = "recent" | "stale" | "very_stale";

function ageMsSince(
  timestamp: string | Date | null | undefined,
  now: Date,
): number | null {
  if (timestamp == null) return null;
  const instant = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) return null;
  return now.getTime() - ms;
}

/**
 * Classifies how stale a last-confirmed / updated timestamp is.
 * Missing or invalid timestamps are `very_stale` (conservative for recovery UX).
 */
export function getEquipmentStalenessLevel(
  updatedAtOrLastSeenAt: string | Date | null | undefined,
  now: Date = new Date(),
): EquipmentStalenessLevel {
  const ageMs = ageMsSince(updatedAtOrLastSeenAt, now);
  if (ageMs == null || ageMs < 0) return "very_stale";
  if (ageMs < RECENTLY_CONFIRMED_MS) return "recent";
  if (ageMs < VERY_STALE_MS) return "stale";
  return "very_stale";
}

/** True when last confirm/seen is at or past the stale threshold. */
export function isEquipmentStale(
  updatedAtOrLastSeenAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const ageMs = ageMsSince(updatedAtOrLastSeenAt, now);
  if (ageMs == null) return true;
  if (ageMs < 0) return false;
  return ageMs >= STALE_MS;
}

/** True when checkout duration meets or exceeds the recovery threshold. */
export function isCheckedOutTooLong(
  checkedOutAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const ageMs = ageMsSince(checkedOutAt, now);
  if (ageMs == null) return false;
  if (ageMs < 0) return false;
  return ageMs >= CHECKED_OUT_TOO_LONG_MS;
}
