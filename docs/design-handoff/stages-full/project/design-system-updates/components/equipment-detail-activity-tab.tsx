// Lands at: src/components/equipment/EquipmentDetailActivityTab.tsx
// Design System Alignment — Phase 21 (review item 15, "Clinical Timeline
// Component"). Full-file replacement (same reasoning as StatusBadge/Card in
// Phases 14/15 — too many distinct spots for a safe sed diff): was a flat
// stack of individually-carded rows (bg-card border-border/60 shadow-sm —
// the SAME Card-shadow-override bug Phase 10/13 fixed elsewhere but missed
// here, gone now too). Stage 6's own mockup already established the
// dot+line "Accountability" visual for this exact content; this wires the
// real thing up via the new Timeline/TimelineRow primitives
// (equipment-timeline.tsx). Data, loading and empty-state logic are
// UNCHANGED — only the container markup for each entry changed.
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Timeline, TimelineRow } from "@/components/ui/equipment-timeline";
import { STATUS_LABELS } from "@/types";
import type { ScanLog, TransferLog } from "@/types";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { FolderOpen, Loader2 } from "lucide-react";

type ActivityEntry =
  | { kind: "scan"; id: string; at: Date; scan: ScanLog }
  | { kind: "transfer"; id: string; at: Date; transfer: TransferLog };

interface EquipmentDetailActivityTabProps {
  scanLogs: ScanLog[] | undefined;
  transfers: TransferLog[] | undefined;
  logsLoading: boolean;
  transfersLoading: boolean;
  hasOlderLogs: boolean;
  isFetchingOlderLogs: boolean;
  onLoadOlder: () => void;
}

export function EquipmentDetailActivityTab({
  scanLogs,
  transfers,
  logsLoading,
  transfersLoading,
  hasOlderLogs,
  isFetchingOlderLogs,
  onLoadOlder,
}: EquipmentDetailActivityTabProps) {
  const timeline = useMemo(() => {
    const items: ActivityEntry[] = [];
    for (const scan of scanLogs ?? []) {
      items.push({
        kind: "scan",
        id: `scan-${scan.id}`,
        at: new Date(scan.timestamp),
        scan,
      });
    }
    for (const transfer of transfers ?? []) {
      items.push({
        kind: "transfer",
        id: `transfer-${transfer.id}`,
        at: new Date(transfer.timestamp),
        transfer,
      });
    }
    return items.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [scanLogs, transfers]);

  const isLoading = logsLoading || transfersLoading;

  if (isLoading && timeline.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <Card className="bg-card border-border/60">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          {t.equipmentDetail.activityEmpty}
        </CardContent>
      </Card>
    );
  }

  return (
    <Timeline className="px-1" data-testid="equipment-activity-timeline">
      {timeline.map((entry, i) => {
        const isLast = i === timeline.length - 1;
        return entry.kind === "scan" ? (
          <TimelineRow
            key={entry.id}
            isLast={isLast}
            current={i === 0}
            tone={i === 0 ? "ok" : "neutral"}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    {t.equipmentDetail.activityScan}
                  </Badge>
                  <Badge variant={statusToBadgeVariant(entry.scan.status)} dot>
                    {STATUS_LABELS[entry.scan.status as keyof typeof STATUS_LABELS] ??
                      entry.scan.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground truncate">
                    {entry.scan.userEmail}
                  </span>
                </div>
                {entry.scan.note && (
                  <p className="text-xs text-muted-foreground mt-1">{entry.scan.note}</p>
                )}
                {entry.scan.photoUrl && (
                  <img
                    src={entry.scan.photoUrl}
                    alt={t.equipmentDetail.issuePhoto}
                    width={96}
                    height={96}
                    loading="lazy"
                    decoding="async"
                    className="mt-2 rounded-lg w-24 h-24 object-cover border"
                    style={{ aspectRatio: "1 / 1" }}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(entry.at.toISOString())}
              </p>
            </div>
          </TimelineRow>
        ) : (
          <TimelineRow key={entry.id} isLast={isLast} tone="neutral">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {t.equipmentDetail.activityTransfer}
                </Badge>
                <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">
                  {entry.transfer.fromFolderName ?? "—"} → {entry.transfer.toFolderName ?? "—"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(entry.at.toISOString())}
              </p>
            </div>
          </TimelineRow>
        );
      })}
      {hasOlderLogs && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-11 text-xs"
            onClick={onLoadOlder}
            disabled={isFetchingOlderLogs}
            data-testid="btn-load-older-logs"
          >
            {isFetchingOlderLogs ? (
              <>
                <Loader2 className="w-4 h-4 me-1 animate-spin" />
                {t.equipmentDetail.toast.trying}
              </>
            ) : (
              t.equipmentDetail.loadOlder
            )}
          </Button>
        </div>
      )}
    </Timeline>
  );
}
