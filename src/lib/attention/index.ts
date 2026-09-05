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

/**
 * Statuses that mean "a human needs to deal with this". Mirrors the set
 * `equipmentTriageTier` already treats as attention-worthy, so this does not invent
 * a fifth opinion about what a problem status is.
 */
const PROBLEM_STATUSES: ReadonlySet<string> = new Set([
  "issue",
  "maintenance",
  "critical",
  "needs_attention",
]);

type AttentionInput = {
  status: string;
  lastSeen?: string | Date | null;
  checkedOutById?: string | null;
};

/**
 * Not seen within the staleness window. A checked-out item is exempt: someone is
 * accountable for it, so "nobody has scanned it" is expected rather than alarming.
 * This matches the `!isInUse &&` guard the dashboard's `isMissing` already applied.
 */
function isStaleUnseen(eq: AttentionInput, now: number = Date.now()): boolean {
  if (eq.checkedOutById) return false;
  if (!eq.lastSeen) return true;
  return now - new Date(eq.lastSeen).getTime() > STALE_THRESHOLD_MS;
}

/**
 * THE canonical "needs attention" test — one definition for every management count.
 *
 * Problem status **or** unseen past the staleness window. Deliberately ack-blind:
 * acknowledging an alert changes inbox noise, not fleet truth, so the ack-aware count
 * stays on `/alerts` (inbox semantics) while this answers "what is the state of the
 * fleet" (owner decision, 2026-09-01).
 *
 * Note it does NOT short-circuit on `checkedOutById` the way `equipmentTriageTier`
 * does — a broken item is broken whoever is holding it. That short-circuit, combined
 * with never reading `lastSeen`, is why `/home`'s coverage ring could read 100% while
 * `/dashboard` read 65 on the same fleet.
 */
export function needsAttention(eq: AttentionInput, now: number = Date.now()): boolean {
  return PROBLEM_STATUSES.has(eq.status) || isStaleUnseen(eq, now);
}

/** Fleet-level count of {@link needsAttention}. */
export function countNeedsAttention(
  equipment: readonly AttentionInput[],
  now: number = Date.now(),
): number {
  let n = 0;
  for (const eq of equipment) if (needsAttention(eq, now)) n++;
  return n;
}
