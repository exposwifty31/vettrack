import type { Alert } from "@/types";
import { isUrgentAlert } from "@/lib/alert-counts";

/**
 * The single attention taxonomy for the whole app.
 *
 * One tier vocabulary — `critical | urgent | maintenance` — shared by every
 * surface that signals "this needs attention" (the alert bell today; rooms
 * staleness and equipment recovery reference the same tiers). Aggregation +
 * tiering here is what turns a wall of identical low-urgency warnings (the
 * "60" the review flagged) into a few ranked, counted rows.
 */
export type AttentionTier = "critical" | "urgent" | "maintenance";

const TIER_ORDER: Record<AttentionTier, number> = { critical: 0, urgent: 1, maintenance: 2 };

/** Tier of a single equipment alert. Severity wins; then urgent (issue/overdue); else maintenance. */
export function tierForAlert(alert: Alert): AttentionTier {
  if (alert.severity === "critical") return "critical";
  if (isUrgentAlert(alert)) return "urgent";
  return "maintenance";
}

export type AttentionGroup = {
  type: Alert["type"];
  tier: AttentionTier;
  count: number;
  alerts: Alert[];
};

/**
 * Collapse per-equipment alerts into one group per type, sorted by tier then
 * size — so "12 devices not scanned in 14+ days" reads as a single tiered row
 * instead of 12 identical warnings. Genuine events (issue/overdue) sort above
 * maintenance staleness.
 */
export function aggregateAlerts(alerts: Alert[]): AttentionGroup[] {
  const byType = new Map<Alert["type"], Alert[]>();
  for (const a of alerts) {
    const arr = byType.get(a.type);
    if (arr) arr.push(a);
    else byType.set(a.type, [a]);
  }
  const groups: AttentionGroup[] = [];
  byType.forEach((arr, type) => {
    groups.push({ type, tier: tierForAlert(arr[0]!), count: arr.length, alerts: arr });
  });
  return groups.sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.count - a.count,
  );
}

/** Bounded badge label — caps at "9+" so a high count never manufactures urgency. */
export function formatBadgeCount(n: number): string {
  return n > 9 ? "9+" : String(n);
}

/** Rooms audit staleness cutoff — one shared source for the 24h threshold. */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
