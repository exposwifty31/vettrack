import { Link } from "wouter";
import { Activity, ArrowLeftRight, Plus, ScanLine } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSection } from "@/components/ui/loading-section";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { t, getStoredLocale } from "@/lib/i18n";
import type { ActivityFeedItem } from "@/types";

/** Locale-aware "6:30 AM" / "6:30" clock. */
function formatClock(value: Date | string): string {
  const localeTag = getStoredLocale() === "he" ? "he-IL" : "en-US";
  return new Date(value).toLocaleTimeString(localeTag, { hour: "numeric", minute: "2-digit" });
}

type ActivityStyle = { bg: string; fg: string; Icon: typeof ScanLine; label: () => string };

/** Map an activity-feed row onto its Stage-3 tinted glyph + action verb. */
function activityStyle(item: ActivityFeedItem): ActivityStyle {
  switch (item.type) {
    case "transfer":
      return {
        bg: "rgb(var(--sys-blue) / 0.12)",
        fg: "rgb(var(--sys-blue))",
        Icon: ArrowLeftRight,
        label: () => t.homePage.activityMoved,
      };
    case "created":
      return {
        bg: "rgb(var(--sys-green) / 0.12)",
        fg: "rgb(var(--sys-green))",
        Icon: Plus,
        label: () => t.homePage.activityAdded,
      };
    case "scan":
    default:
      return {
        bg: "rgb(var(--sys-green) / 0.12)",
        fg: "rgb(var(--sys-green))",
        Icon: ScanLine,
        label: () => t.homePage.activityScanned,
      };
  }
}

/**
 * Recent-activity list (extracted from home.tsx). Desktop-only affordance — the
 * caller gates on `isDesktop && active`. Consumed by the ops surface as recent-
 * change context beneath the coverage read.
 */
export function RecentActivityCard({
  items,
  isLoading,
  currentUserId,
}: {
  items: ActivityFeedItem[];
  isLoading: boolean;
  currentUserId: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-[16px] border border-ivory-border bg-ivory-surface pb-1">
      <div className="flex items-center justify-between px-[18px] pb-2 pt-3">
        <p className="text-[16px] font-semibold text-ivory-text">{t.homePage.recentActivity}</p>
        {/* /audit-log is WebOnlyGuard-walled — on native the link silently bounced to /home. */}
        {!isCapacitorNative() && (
          <Link href="/audit-log" className="text-[13px] font-semibold text-brand">
            {t.homePage.viewAll}
          </Link>
        )}
      </div>
      {isLoading ? (
        <div className="px-[18px] pb-3">
          <LoadingSection rows={4} />
        </div>
      ) : items.length > 0 ? (
        items.map((item) => {
          const s = activityStyle(item);
          const Icon = s.Icon;
          return (
            <Link
              key={item.id}
              href={`/equipment/${item.equipmentId}`}
              className="flex items-center gap-3 border-t border-ivory-border px-[18px] py-2.5 transition-colors hover:bg-muted/40"
            >
              <span
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
                style={{ background: s.bg, color: s.fg }}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ivory-text">
                  {s.label()}
                  {" · "}
                  <span className="font-normal text-ivory-text3">{item.equipmentName}</span>
                </p>
                <p className="mt-0.5 truncate text-[12px] font-medium text-ivory-text3">
                  {item.userId === currentUserId
                    ? t.homePage.activityYou
                    : item.userEmail?.split("@")[0] ?? ""}
                </p>
              </div>
              <span className="shrink-0 font-num text-[12px] tabular-nums text-ivory-text3">
                {formatClock(item.timestamp)}
              </span>
            </Link>
          );
        })
      ) : (
        <EmptyState
          icon={Activity}
          message={t.homePage.activityFeedEmpty}
          subMessage={t.homePage.activityFeedEmptyHint}
        />
      )}
    </section>
  );
}
