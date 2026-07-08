import { t } from "@/lib/i18n";

/**
 * Canonical keyed relative-time formatter (Phase 7 foundation).
 *
 * Generalized verbatim from the alerts controller's copy
 * (`src/features/alerts/hooks/use-alerts-controller.ts`). It resolves i18n keys
 * across two namespaces (`t.alerts.timeAgo.*` + `t.alertsPage.*`), so callers get
 * Hebrew-default localized, RTL-correct output for free — new Phase-7 console code
 * should import from HERE rather than authoring its own.
 *
 * Deferred follow-up (gated on an `alerts`-fence sign-off, per the Phase 7
 * roadmap §2): make `use-alerts-controller.ts`'s `formatRelativeTime` and the
 * `src/lib/utils.ts` variant delegate to this module so it is the single source.
 * Until then this is the canonical target for new code, not a third ad-hoc copy.
 */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t.alerts.timeAgo.justNow;
  if (diffMin === 1) return t.alertsPage.oneMinuteAgo;
  if (diffMin < 60) return t.alertsPage.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return t.alertsPage.oneHourAgo;
  if (diffHr < 24) return t.alertsPage.hoursAgo(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? t.alertsPage.oneDayAgo : t.alertsPage.daysAgo(diffDay);
}
