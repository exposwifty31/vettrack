import { useMemo } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, DoorOpen, MapPin } from "lucide-react";
import { DataTable, type Column } from "@/desktop/management/DataTable";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { Room } from "@/types";
import { SyncBadge, computeEffectiveStatus } from "@/pages/rooms/room-sync-status";

interface RoomsTableProps {
  rooms: Room[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Dense readiness body for `/rooms` at lg+ (Track A). The two-column card grid in
 * `rooms-list.tsx` is unchanged and still serves narrow widths.
 *
 * The sync column reuses `computeEffectiveStatus` + `SyncBadge` from the page rather
 * than re-deriving staleness, so the grid and the table cannot disagree about whether
 * a room is stale.
 */
export function RoomsTable({ rooms, isLoading, isError, onRetry }: RoomsTableProps) {
  const [, navigate] = useLocation();

  const columns = useMemo<Column<Room>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (r) => r.name,
        cell: (r) => (
          <span className="flex flex-col">
            <Bdi className="font-medium">{r.name}</Bdi>
            {r.floor ? (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                <Bdi>{r.floor}</Bdi>
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: "available",
        header: t.roomsListPage.summaryAvailable,
        sortValue: (r) => r.availableCount ?? 0,
        cell: (r) => (
          <span data-testid={`rooms-table-availability-${r.id}`} className="whitespace-nowrap">
            <span className="font-bold text-primary">{r.availableCount ?? 0}</span>
            <span className="text-xs text-muted-foreground">/{r.totalEquipment ?? 0}</span>
          </span>
        ),
      },
      {
        key: "inUse",
        header: t.roomsListPage.summaryInUse,
        sortValue: (r) => r.inUseCount ?? 0,
        cell: (r) => r.inUseCount ?? 0,
      },
      {
        key: "issues",
        header: t.roomsListPage.summaryIssues,
        sortValue: (r) => r.issueCount ?? 0,
        cell: (r) =>
          (r.issueCount ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-md border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] px-1.5 py-0.5 text-xs font-semibold text-[var(--status-issue-fg)]">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {r.issueCount}
            </span>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
      },
      {
        key: "sync",
        header: t.roomsListPage.summarySynced,
        sortValue: (r) => computeEffectiveStatus(r),
        cell: (r) => <SyncBadge status={computeEffectiveStatus(r)} />,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      rows={rooms}
      rowKey={(r) => r.id}
      rowTestId={(r) => `room-row-${r.id}`}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      emptyIcon={DoorOpen}
      emptyMessage={t.roomsListPage.emptyRooms}
      onRowClick={(r) => navigate(`/rooms/${r.id}`)}
    />
  );
}
