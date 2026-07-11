import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScanLog, TransferLog } from "@/types";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { FolderOpen, Loader2 } from "lucide-react";

type ActivityEntry =
  | { kind: "scan"; id: string; at: Date; scan: ScanLog }
  | { kind: "transfer"; id: string; at: Date; transfer: TransferLog };

// The bulk room-verify endpoint (POST /api/equipment/bulk-verify-room) writes
// a fixed-format English note ("Room verified: {room}") to scan logs — the
// same prefix `src/pages/room-radar.tsx` matches on to detect this event
// type. That prefix is a load-bearing identifier (server-stored, matched
// elsewhere), so it stays English; only the DISPLAY is localized here by
// extracting the room name and rendering it through a translated template.
const ROOM_VERIFIED_NOTE_PREFIX = "Room verified: ";

function scanNoteDisplay(note: string): string {
  if (note.startsWith(ROOM_VERIFIED_NOTE_PREFIX)) {
    return t.equipmentDetail.activityRoomVerified(note.slice(ROOM_VERIFIED_NOTE_PREFIX.length));
  }
  return note;
}

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
      <Card className="bg-card border-border/60 shadow-sm">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          {t.equipmentDetail.activityEmpty}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="equipment-activity-timeline">
      {timeline.map((entry) =>
        entry.kind === "scan" ? (
          <Card key={entry.id} className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {t.equipmentDetail.activityScan}
                    </Badge>
                    <Badge variant={statusToBadgeVariant(entry.scan.status)}>
                      {equipmentStatusLabel(entry.scan.status)}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      {entry.scan.staffName || t.appointmentsPage.unknownUser}
                    </span>
                  </div>
                  {entry.scan.note && (
                    <p className="text-xs text-muted-foreground mt-1">{scanNoteDisplay(entry.scan.note)}</p>
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
            </CardContent>
          </Card>
        ) : (
          <Card key={entry.id} className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-3">
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
            </CardContent>
          </Card>
        ),
      )}
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
    </div>
  );
}
