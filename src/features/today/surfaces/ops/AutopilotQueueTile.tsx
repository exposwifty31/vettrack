import { useLocation } from "wouter";
import { ListChecks } from "lucide-react";
import { t } from "@/lib/i18n";
import { kindTitle } from "@/features/autopilot/kind-title";
import { OpsTile, TileHeader, SkeletonRows } from "./ops-tile-helpers";
import type { ActionProposalKind } from "@/types/action-proposals";

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable F) — ops-home queue-summary tile
 * (mirrors `ExceptionsTile`'s tile-composition convention): count of staged
 * Autopilot proposals + a "mostly {kind}" hint, tap-through to the full
 * approval queue (`/autopilot/queue`).
 */
export function AutopilotQueueTile({
  count,
  topKind,
  isLoading,
}: {
  count: number;
  topKind: ActionProposalKind | null;
  isLoading: boolean;
}) {
  const [, navigate] = useLocation();

  return (
    <OpsTile testId="ops-autopilot-queue-tile">
      <TileHeader
        title={t.autopilotQueue.tile.title}
        href="/autopilot/queue"
        aside={
          count > 0 ? (
            <span
              dir="ltr"
              className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px] text-[11px] font-bold text-white"
              style={{ background: "rgb(var(--sys-orange))" }}
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null
        }
      />
      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : count === 0 ? (
        <p className="text-sm text-ivory-text3">{t.autopilotQueue.tile.empty}</p>
      ) : (
        <button
          type="button"
          onClick={() => navigate("/autopilot/queue")}
          className="-mx-2 flex min-h-[44px] items-center gap-2.5 rounded-xl px-2 text-start transition-colors hover:bg-muted/40"
        >
          <ListChecks className="h-4 w-4 shrink-0 text-ivory-text3" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-ivory-text">
            {topKind ? t.autopilotQueue.tile.topKindHint(kindTitle(topKind)) : null}
          </span>
        </button>
      )}
    </OpsTile>
  );
}
