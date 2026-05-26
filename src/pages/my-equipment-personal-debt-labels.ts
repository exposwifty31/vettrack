import type { PersonalEquipmentDebtSnapshot } from "@/lib/equipment-personal-debt";

/** i18n keys under `myEquipmentPage` for personal debt banners. */
export type PersonalDebtBannerKey =
  | "personalDebtBannerCheckedOutLong"
  | "personalDebtBannerVeryStale"
  | "personalDebtBannerStale";

/** i18n keys under `myEquipmentPage` for optional tier breakdown segments. */
export type PersonalDebtBreakdownKey =
  | "personalDebtBreakdownCheckedOutLong"
  | "personalDebtBreakdownVeryStale"
  | "personalDebtBreakdownStale";

/**
 * Maps aggregate snapshot → dominant-tier banner key, or null when no attention items.
 */
export function resolvePersonalDebtBannerKey(
  snapshot: PersonalEquipmentDebtSnapshot,
): PersonalDebtBannerKey | null {
  if (snapshot.attentionCount === 0 || snapshot.dominantTier === "none") {
    return null;
  }
  switch (snapshot.dominantTier) {
    case "checked_out_long":
      return "personalDebtBannerCheckedOutLong";
    case "very_stale":
      return "personalDebtBannerVeryStale";
    case "stale":
      return "personalDebtBannerStale";
    default:
      return null;
  }
}

/** Non-zero tier buckets in display order (long checkout → very stale → stale). */
export function personalDebtBreakdownSegments(
  snapshot: PersonalEquipmentDebtSnapshot,
): Array<{ key: PersonalDebtBreakdownKey; count: number }> {
  const segments: Array<{ key: PersonalDebtBreakdownKey; count: number }> = [];
  if (snapshot.byTier.checkedOutLong > 0) {
    segments.push({
      key: "personalDebtBreakdownCheckedOutLong",
      count: snapshot.byTier.checkedOutLong,
    });
  }
  if (snapshot.byTier.veryStale > 0) {
    segments.push({
      key: "personalDebtBreakdownVeryStale",
      count: snapshot.byTier.veryStale,
    });
  }
  if (snapshot.byTier.stale > 0) {
    segments.push({
      key: "personalDebtBreakdownStale",
      count: snapshot.byTier.stale,
    });
  }
  return segments;
}

/** Joins breakdown segment labels with " · "; null when no tier buckets. */
export function formatPersonalDebtBreakdown(
  snapshot: PersonalEquipmentDebtSnapshot,
  labels: Record<PersonalDebtBreakdownKey, string>,
): string | null {
  const segments = personalDebtBreakdownSegments(snapshot);
  if (segments.length === 0) return null;
  return segments
    .map(({ key, count }) => labels[key].replace("{count}", String(count)))
    .join(" · ");
}
