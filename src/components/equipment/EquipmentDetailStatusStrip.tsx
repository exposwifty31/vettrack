import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Equipment, EquipmentStatus } from "@/types";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { formatRelativeTime, getExpiryBadgeState } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  isRfidSubtitleFresh,
  shouldShowRfidAttentionBadge,
} from "@/lib/equipment-rfid-display";
import type {
  EquipmentDetailRecoveryBadgeKey,
  EquipmentDetailRecoveryCalloutKey,
} from "@/lib/equipment-detail-recovery-labels";
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Package } from "lucide-react";

const STATUS_CONFIG: Record<
  string,
  { icon: LucideIcon; color: string; iconBg: string }
> = {
  ok: { icon: CheckCircle2, color: "text-emerald-600", iconBg: "bg-emerald-100" },
  issue: { icon: AlertTriangle, color: "text-red-600", iconBg: "bg-red-100" },
  maintenance: { icon: AlertTriangle, color: "text-amber-600", iconBg: "bg-amber-100" },
  sterilized: { icon: CheckCircle2, color: "text-blue-600", iconBg: "bg-blue-100" },
  critical: { icon: AlertTriangle, color: "text-red-700", iconBg: "bg-red-100" },
  needs_attention: { icon: AlertTriangle, color: "text-orange-600", iconBg: "bg-orange-100" },
  inactive: { icon: Package, color: "text-gray-500", iconBg: "bg-gray-100" },
};

export interface EquipmentDetailStatusStripProps {
  equipment: Equipment;
  recoveryCalloutKey?: EquipmentDetailRecoveryCalloutKey | null;
  recoveryBadgeKey?: EquipmentDetailRecoveryBadgeKey | null;
  undoCountdown: number;
  undoWindowSec: number;
  showOperationalState: boolean;
  overdue: boolean;
  sterilizationDue: boolean;
  onRfidAttention?: () => void;
}

export function EquipmentDetailStatusStrip({
  equipment,
  recoveryCalloutKey,
  recoveryBadgeKey,
  undoCountdown,
  undoWindowSec,
  showOperationalState,
  overdue,
  sterilizationDue,
  onRfidAttention,
}: EquipmentDetailStatusStripProps) {
  const status = equipment.status as EquipmentStatus;
  const statusConf = STATUS_CONFIG[status];
  const StatusIcon = statusConf?.icon ?? Package;
  const expiryState = getExpiryBadgeState(equipment.expiryDate);

  return (
    <Card className="bg-card border-border/60 shadow-sm" data-testid="equipment-detail-status-strip">
      <CardContent className="p-3 space-y-2">
        {recoveryCalloutKey && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
            data-testid="equipment-detail-recovery-callout"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{t.equipmentDetail[recoveryCalloutKey]}</p>
          </div>
        )}

        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${statusConf?.iconBg ?? "bg-muted"}`}
          >
            <StatusIcon className={`w-4 h-4 ${statusConf?.color ?? ""}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusToBadgeVariant(status)} className="text-xs">
                {equipmentStatusLabel(status)}
              </Badge>
              {recoveryBadgeKey && (
                <Badge variant="outline" className="text-xs" data-testid="equipment-detail-recovery-badge">
                  {t.equipmentDetail[recoveryBadgeKey]}
                </Badge>
              )}
              {expiryState === "expired" && (
                <Badge variant="issue" className="text-[10px]">
                  <CalendarX className="w-3 h-3 me-1" />
                  {t.equipmentDetail.expiryExpired}
                </Badge>
              )}
              {expiryState === "expiring_soon" && (
                <Badge variant="maintenance" className="text-[10px]">
                  <CalendarClock className="w-3 h-3 me-1" />
                  {t.equipmentDetail.expirySoon}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t.equipmentDetail.lastScanLabel(formatRelativeTime(equipment.lastSeen?.toString()))}
            </p>
            {isRfidSubtitleFresh(equipment.lastRfidSeenAt) && equipment.lastRfidRoomName && (
              <p className="text-xs text-muted-foreground" data-testid="equipment-detail-rfid-last-seen">
                {t.equipment.rfidLastSeen.line(
                  equipment.lastRfidRoomName,
                  formatRelativeTime(equipment.lastRfidSeenAt!),
                )}
              </p>
            )}
            {showOperationalState && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {t.equipmentTruth.detailStatusSeeTruth}
              </p>
            )}
          </div>
        </div>

        {shouldShowRfidAttentionBadge(equipment) && onRfidAttention && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-9 text-xs border-amber-300 text-amber-900 dark:text-amber-200"
            data-testid="equipment-detail-rfid-attention"
            onClick={onRfidAttention}
          >
            {t.dockReturn.confirmAtDockCta}
          </Button>
        )}

        {undoCountdown > 0 && (
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full"
              style={{ width: `${(undoCountdown / undoWindowSec) * 100}%` }}
            />
          </div>
        )}

        {(overdue || sterilizationDue) && (
          <div className="flex flex-col gap-1 text-xs font-medium">
            {overdue && (
              <p className="text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t.equipmentDetail.maintenanceOverdue}
              </p>
            )}
            {sterilizationDue && (
              <p className="text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t.equipmentDetail.sterilizationDue}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
