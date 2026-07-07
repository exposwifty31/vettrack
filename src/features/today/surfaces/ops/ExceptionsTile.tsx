import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { Bdi } from "@/components/ui/bdi";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { t } from "@/lib/i18n";
import { OpsTile, TileHeader, SkeletonRows } from "./ops-tile-helpers";
import type { Alert } from "@/types";

function alertColor(type: Alert["type"]): string {
  if (type === "issue") return "var(--status-issue-fg)";
  if (type === "overdue") return "var(--status-stale-fg)";
  return "var(--ivory-text3)";
}

/**
 * Ops "what is broken" tile — worst-first, ack-filtered exceptions with a red
 * count badge (reimplemented from HomeTabletDashboard's alerts tile). Rows link to
 * the item; empty state when nothing is outstanding.
 */
export function ExceptionsTile({
  topExceptions,
  activeAlertCount,
  isLoading,
}: {
  topExceptions: Alert[];
  activeAlertCount: number;
  isLoading: boolean;
}) {
  const [, navigate] = useLocation();

  return (
    <OpsTile testId="ops-exceptions-tile">
      <TileHeader
        title={t.homeSurface.exceptions}
        href="/alerts"
        aside={
          activeAlertCount > 0 ? (
            <span
              dir="ltr"
              className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px] text-[11px] font-bold text-white"
              style={{ background: "rgb(var(--sys-red))" }}
            >
              {activeAlertCount > 99 ? "99+" : activeAlertCount}
            </span>
          ) : null
        }
      />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : topExceptions.length === 0 ? (
        <p className="text-sm text-ivory-text3">{t.homeSurface.noExceptions}</p>
      ) : (
        <div className="flex flex-col">
          {topExceptions.map((alert) => (
            <button
              key={`${alert.equipmentId}:${alert.type}`}
              type="button"
              onClick={() => navigate(`/equipment/${alert.equipmentId}`)}
              className="-mx-2 flex min-h-[44px] items-center gap-2.5 rounded-xl px-2 text-start transition-colors hover:bg-muted/40"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden style={{ color: alertColor(alert.type) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ivory-text">
                  <Bdi>{alert.equipmentName}</Bdi>
                </span>
                {alert.detail && (
                  <span className="block truncate text-xs text-ivory-text3">{alert.detail}</span>
                )}
              </span>
              <ForwardChevron className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </OpsTile>
  );
}
