/**
 * Locale-aware rendering of an autopilot proposal's date-only value for PROSE.
 *
 * The three composers each interpolate a `YYYY-MM-DD` day into a translated
 * `summary` template. Passing the raw ISO string leaves a machine-readable
 * date sitting inside a Hebrew sentence, which is the defect this helper
 * exists to remove.
 *
 * Follows `server/workers/expiryCheckWorker.ts`'s `formatExpiryDate`: parse at
 * UTC midnight, and fail SOFT — an unparseable value is returned unchanged so
 * a single malformed row cannot throw a worker mid-scan.
 *
 * One deliberate difference from that precedent: the format is pinned to
 * `timeZone: "UTC"`. A `YYYY-MM-DD` is a calendar date with no zone, and the
 * value is parsed at UTC midnight; rendering it in the host's local zone shifts
 * it a day backwards anywhere west of UTC (verified: `2026-07-22` renders as
 * `7/21/2026` under `TZ=America/New_York`). The proposal must name the day the
 * scan actually covered.
 *
 * PROSE ONLY. Never use this for `sourceSessionId` (the idempotency key behind
 * the `(clinicId, kind, sourceSessionId)` unique index), `sourceRef`,
 * `draftContent`, or `citedFacts[].at` — those are stored data and must stay
 * byte-identical to the raw input.
 */
import type { Locale } from "../../../lib/i18n/index.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function formatProposalDate(isoDay: string, locale: Locale): string {
  if (!ISO_DAY.test(isoDay)) {
    return isoDay;
  }
  const parsed = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDay;
  }
  // The UTC parser NORMALIZES calendar overflow (2026-02-30 parses as Mar 2),
  // which NaN cannot catch — render only a day that round-trips intact, so an
  // invalid calendar value falls back to the raw input instead of the wrong day.
  if (parsed.toISOString().slice(0, 10) !== isoDay) {
    return isoDay;
  }
  return parsed.toLocaleDateString(locale === "he" ? "he-IL" : "en-US", { timeZone: "UTC" });
}
