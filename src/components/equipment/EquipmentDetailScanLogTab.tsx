import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScanLog } from "@/types";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";

export type ScanHistoryRange = "today" | "7d" | "all";

const RANGES: ScanHistoryRange[] = ["today", "7d", "all"];

function rangeLabel(range: ScanHistoryRange): string {
  return range === "today"
    ? t.equipmentDetail.scanLogToday
    : range === "7d"
      ? t.equipmentDetail.scanLogWeek
      : t.equipmentDetail.scanLogAll;
}

interface EquipmentDetailScanLogTabProps {
  range: ScanHistoryRange;
  onRangeChange: (range: ScanHistoryRange) => void;
  isLoading: boolean;
  logs: ScanLog[] | undefined;
}

/**
 * Admin scan-log tab for the equipment detail page (Phase 7S extraction). Presentational:
 * a range toggle + the admin scan-log list. Behavior-preserving move out of the
 * equipment-detail.tsx god-file — data + range state stay owned by the page.
 */
export function EquipmentDetailScanLogTab({
  range,
  onRangeChange,
  isLoading,
  logs,
}: EquipmentDetailScanLogTabProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Button
            key={r}
            variant={range === r ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => onRangeChange(r)}
          >
            {rangeLabel(r)}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </>
      ) : !logs?.length ? (
        <Card className="bg-card border-border/60 shadow-sm">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground text-sm">{t.equipmentDetail.scanLogEmpty}</p>
          </CardContent>
        </Card>
      ) : (
        logs.map((log) => (
          <Card key={log.id} className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={statusToBadgeVariant(log.status)}>
                      {equipmentStatusLabel(log.status)}
                    </Badge>
                    <span className="text-xs font-medium truncate">
                      {log.staffName || log.userEmail}
                    </span>
                    {log.staffRole && (
                      <span className="text-xs text-muted-foreground capitalize">
                        {log.staffRole.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {log.note && <p className="text-xs text-muted-foreground">{log.note}</p>}
                </div>
                <p className="text-xs text-muted-foreground shrink-0">
                  {formatRelativeTime(log.timestamp.toString())}
                </p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
