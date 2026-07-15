import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ListChecks, PackageX } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Bdi } from "@/components/ui/bdi";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import type { RoomSweepItem } from "@/types";
import { SweepStationGroup } from "./SweepStationGroup";

interface RoomSweepProps {
  roomId: string;
  roomName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface StationGroup {
  key: string;
  label: string;
  items: RoomSweepItem[];
}

const NO_STATION_KEY = "__no_station__";

function groupByStation(items: RoomSweepItem[]): StationGroup[] {
  const groups = new Map<string, StationGroup>();
  for (const item of items) {
    const key = item.homeDockName ?? NO_STATION_KEY;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        label: item.homeDockName ?? t.roomSweep.noStationGroup,
        items: [item],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === NO_STATION_KEY) return 1;
    if (b.key === NO_STATION_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Mobile-first Room Sweep floor tool (docking P3 T3.2b, design §5/§6.2/§6.3).
 *
 * Consumes the T3.2a server endpoints: `roomSweepList` for the expected
 * (homed) item list, `commitRoomSweep` to post the confirmed-present ids.
 * Resting items default NOT confirmed (accuracy-first) — a technician must
 * actively confirm presence, with "Mark all present" bulk shortcuts for the
 * common fully-stocked case. Checked-out items are read-only and D-9
 * accounted: never toggleable, never counted present or missing.
 */
export function RoomSweep({ roomId, roomName, open, onOpenChange }: RoomSweepProps) {
  const queryClient = useQueryClient();
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["/api/docking/rooms", roomId, "sweep"],
    queryFn: () => api.docking.roomSweepList(roomId),
    enabled: open && !!roomId,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const restingItems = useMemo(() => items.filter((item) => !item.checkedOutById), [items]);
  const groups = useMemo(() => groupByStation(items), [items]);

  const presentCount = useMemo(
    () => restingItems.filter((item) => confirmedIds.has(item.id)).length,
    [restingItems, confirmedIds],
  );
  const missingCount = restingItems.length - presentCount;

  const toggleItem = (id: string) => {
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markPresent = (ids: string[]) => {
    if (ids.length === 0) return;
    setConfirmedIds((prev) => new Set([...prev, ...ids]));
    haptics.tap();
  };

  const resetAndClose = () => {
    setConfirmedIds(new Set());
    onOpenChange(false);
  };

  const commitMut = useMutation({
    mutationFn: () => api.docking.commitRoomSweep(roomId, { confirmedEquipmentIds: Array.from(confirmedIds) }),
    onSuccess: (result) => {
      haptics.tap();
      toast.success(t.roomSweep.sweptToast(result.confirmedCount, result.missingCount));
      queryClient.invalidateQueries({ queryKey: ["/api/docking/rooms", roomId, "sweep"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", roomId] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/docking/reconciliation"] });
      resetAndClose();
    },
    onError: () => toast.error(t.roomSweep.commitError),
  });

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[90dvh] overflow-y-auto flex flex-col p-0"
        data-testid="room-sweep-sheet"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/60 text-start">
          <SheetTitle className="text-base flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" aria-hidden />
            {t.roomSweep.title}
          </SheetTitle>
          {roomName && (
            <p className="text-xs text-muted-foreground truncate">
              <Bdi>{roomName}</Bdi>
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {isLoading ? (
            <div className="flex flex-col gap-3" role="status" aria-live="polite" aria-busy="true">
              <span className="sr-only">{t.common.loading}</span>
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={PackageX} message={t.roomSweep.noHomedItems} subMessage={t.roomSweep.noHomedItemsHint} />
          ) : (
            <>
              {restingItems.length > 0 && (
                <button
                  type="button"
                  data-testid="sweep-mark-all-present"
                  onClick={() => markPresent(restingItems.map((item) => item.id))}
                  className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 text-primary text-sm font-bold min-h-[44px] active:scale-[0.98] transition-transform"
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden />
                  {t.roomSweep.markAllPresent}
                </button>
              )}

              {groups.map((group) => (
                <SweepStationGroup
                  key={group.key}
                  groupKey={group.key}
                  label={group.label}
                  items={group.items}
                  confirmedIds={confirmedIds}
                  onToggle={toggleItem}
                  onMarkGroupPresent={markPresent}
                />
              ))}
            </>
          )}
        </div>

        {!isLoading && items.length > 0 && (
          <div
            data-testid="sweep-commit-bar"
            className="sticky bottom-0 border-t border-border/60 bg-background px-5 py-3 flex items-center gap-3 pb-safe"
          >
            <div className="flex-1 min-w-0 text-sm font-semibold text-foreground">
              {t.roomSweep.summary(presentCount, missingCount)}
            </div>
            <Button
              data-testid="sweep-confirm-button"
              onClick={() => commitMut.mutate()}
              disabled={commitMut.isPending}
            >
              {t.roomSweep.confirmSweep}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
