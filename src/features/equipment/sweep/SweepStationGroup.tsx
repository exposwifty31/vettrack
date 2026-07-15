import { CheckCircle2, Circle, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { RoomSweepItem } from "@/types";

interface SweepStationGroupProps {
  /** Stable group identity for testids (raw dock name, or the no-station sentinel). */
  groupKey: string;
  /** Display label (translated for the no-station group). */
  label: string;
  items: RoomSweepItem[];
  confirmedIds: Set<string>;
  onToggle: (id: string) => void;
  onMarkGroupPresent: (ids: string[]) => void;
}

/**
 * One station group inside the Room Sweep sheet. Checked-out items are
 * D-9 accounted — rendered read-only with their holder, never toggleable,
 * never counted present/missing (server-side: T3.2a commit route never
 * sweeps or contradicts a checked-out item's anchor).
 */
export function SweepStationGroup({
  groupKey,
  label,
  items,
  confirmedIds,
  onToggle,
  onMarkGroupPresent,
}: SweepStationGroupProps) {
  const restingIds = items.filter((item) => !item.checkedOutById).map((item) => item.id);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <Bdi>{label}</Bdi>
        </h3>
        {restingIds.length > 0 && (
          <button
            type="button"
            data-testid={`sweep-group-mark-present-${groupKey}`}
            onClick={() => onMarkGroupPresent(restingIds)}
            className="text-[11px] font-semibold text-primary hover:underline min-h-[32px] px-1"
          >
            {t.roomSweep.markAllPresent}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const isCheckedOut = !!item.checkedOutById;

          if (isCheckedOut) {
            const holder = item.checkedOutByEmail?.split("@")[0] ?? t.roomRadarPage.unknownHolder;
            return (
              <div
                key={item.id}
                data-testid={`sweep-item-checked-out-${item.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border/60 bg-muted/40 opacity-80"
              >
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="text-sm font-semibold truncate">
                    <Bdi>{item.name}</Bdi>
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <User className="w-3 h-3 shrink-0" aria-hidden />
                    <Bdi>{t.roomSweep.withHolder(holder)}</Bdi>
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {t.roomSweep.checkedOutBadge}
                </Badge>
              </div>
            );
          }

          const isPresent = confirmedIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`sweep-item-toggle-${item.id}`}
              aria-pressed={isPresent}
              onClick={() => onToggle(item.id)}
              className={cn(
                "flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border text-start transition-colors min-h-[52px] active:scale-[0.98]",
                isPresent
                  ? "border-[var(--status-ok-border)] bg-[var(--status-ok-bg)]"
                  : "border-border bg-card hover:bg-muted"
              )}
            >
              <p dir="auto" className="text-sm font-semibold truncate min-w-0 flex-1">
                <Bdi>{item.name}</Bdi>
              </p>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-bold shrink-0",
                  isPresent ? "text-[var(--status-ok-fg)]" : "text-muted-foreground"
                )}
              >
                {isPresent ? (
                  <CheckCircle2 className="w-5 h-5" aria-hidden />
                ) : (
                  <Circle className="w-5 h-5" aria-hidden />
                )}
                {isPresent ? t.roomSweep.present : t.roomSweep.notPresent}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
