import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Package, SlidersHorizontal } from "lucide-react";
import { DataTable, type Column } from "@/desktop/management/DataTable";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { formatRelativeTime } from "@/lib/relative-time";
import { Button } from "@/components/ui/button";
import { useExperience } from "@/hooks/use-experience";
import { EquipmentStatusSheet } from "@/features/equipment/desktop/EquipmentStatusSheet";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

interface EquipmentTableProps {
  equipment: Equipment[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** Em-dash placeholder for a column with nothing to show, so rows stay aligned. */
const BLANK = "—";

/**
 * Dense desktop body for `/equipment` (Track A). The mobile/native card list in
 * `src/pages/equipment-list.tsx` is unchanged and still owns narrow widths; this
 * is what a management browser gets instead.
 *
 * Every cell reuses the helper the card already uses — display name, status label,
 * status badge variant, relative time — so the console and the card cannot come to
 * disagree about a row. Row click lands on the same `/equipment/:id` detail route
 * the card links to.
 */
export function EquipmentTable({ equipment, isLoading, isError, onRetry }: EquipmentTableProps) {
  const [, navigate] = useLocation();
  // Same `hasServerAccess` idiom the ten *ConsolePage.tsx files use. Read-only
  // operators keep the dense table; only holders of the write capability see the
  // action column. Server stays the enforcement boundary either way.
  const canWrite = useExperience().can("management.webWrite");
  const [statusTarget, setStatusTarget] = useState<Equipment | null>(null);

  const columns = useMemo<Column<Equipment>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (e) => getEquipmentDisplayName(e),
        cell: (e) => <Bdi className="font-medium">{getEquipmentDisplayName(e)}</Bdi>,
      },
      {
        key: "type",
        header: t.console.colType,
        sortValue: (e) => e.folderName ?? "",
        cell: (e) => (e.folderName ? <Bdi>{e.folderName}</Bdi> : BLANK),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (e) => e.status,
        cell: (e) => (
          <Badge variant={statusToBadgeVariant(e.status)}>{equipmentStatusLabel(e.status)}</Badge>
        ),
      },
      {
        key: "room",
        header: t.console.colRoom,
        sortValue: (e) => e.roomName ?? "",
        cell: (e) => (e.roomName ? <Bdi>{e.roomName}</Bdi> : BLANK),
      },
      {
        key: "lastSeen",
        header: t.console.colLastSeen,
        // Missing timestamps sort last in both directions rather than as the epoch.
        sortValue: (e) => (e.lastSeen ? new Date(e.lastSeen).getTime() : 0),
        cell: (e) => (e.lastSeen ? <Bdi>{formatRelativeTime(new Date(e.lastSeen))}</Bdi> : BLANK),
      },
      ...(canWrite
        ? [
            {
              key: "actions",
              header: t.console.colActions,
              className: "w-16",
              cell: (e: Equipment) => (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  // icon-sm is 36x36; a dense desktop control still wants >=40x40.
                  className="h-10 w-10"
                  aria-label={`${t.equipmentDetail.updateStatusTitle} — ${getEquipmentDisplayName(e)}`}
                  data-testid={`equipment-status-trigger-${e.id}`}
                  onClick={(ev) => {
                    // The row itself navigates to the detail page; reaching for the
                    // status control must not also trigger that.
                    ev.stopPropagation();
                    setStatusTarget(e);
                  }}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              ),
            } satisfies Column<Equipment>,
          ]
        : []),
    ],
    [canWrite],
  );

  return (
    <>
    <DataTable
      columns={columns}
      rows={equipment}
      rowKey={(e) => e.id}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      emptyIcon={Package}
      emptyMessage={t.equipmentList.empty.message}
      onRowClick={(e) => navigate(`/equipment/${e.id}`)}
    />
    {statusTarget ? (
      <EquipmentStatusSheet
        equipment={statusTarget}
        open
        onOpenChange={(next) => {
          if (!next) setStatusTarget(null);
        }}
      />
    ) : null}
    </>
  );
}
