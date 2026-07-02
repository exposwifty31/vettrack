// Lands at: src/components/equipment/EquipmentDetailStatusStrip.tsx
// Design System Alignment — Phase 21 (review item 2, "Accent Rails" —
// extension — plus a hardcoded-color cleanup found while making that
// extension, same anti-pattern family as §38-D3/§39-D3's still-open
// ~10-file list, this file was never on that list). Full-file replacement:
// too many distinct spots (STATUS_CONFIG map, the recovery callout, the
// overdue/sterilizationDue text) for a safe sed diff, same reasoning as
// csv-import-dialog.tsx in Phase 19.
//
// Three changes, all mechanical, no new colors invented:
//  1. STATUS_CONFIG's icon/color/bg — was hardcoded emerald-600/bg-emerald-100,
//     red-600/bg-red-100, amber-600/bg-amber-100, blue-600/bg-blue-100 —
//     retokenized onto the real --status-{ok,issue,maintenance,sterilized}-
//     {fg,bg} vars used everywhere else in this package.
//  2. recoveryCalloutKey banner — was a full 4-side amber border box
//     (border-amber-200/80 bg-amber-50/80), the same "standard alert box"
//     pattern Phase 15 (§34-D2) fixed in AlertCard/ErrorCard — now a rail
//     (border-s-4), same real tokens, no new shape invented.
//  3. overdue/sterilizationDue text — was hardcoded text-red-700/text-amber-700
//     — retokenized onto --status-issue-fg/--status-maint-fg.
// Plus the Card wrapper's shadow-sm (the same shadow-into-Card override bug
// Phase 10/13 fixed elsewhere) is dropped — Card's own primary variant
// (border + inset highlight, no shadow, Phase 21) is now correct as-is.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_LABELS } from "@/types";
import type { Equipment, EquipmentStatus } from "@/types";
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
  ok: { icon: CheckCircle2, color: "text-[var(--status-ok-fg)]", iconBg: "bg-[var(--status-ok-bg)]" },
  issue: { icon: AlertTriangle, color: "text-[var(--status-issue-fg)]", iconBg: "bg-[var(--status-issue-bg)]" },
  maintenance: { icon: AlertTriangle, color: "text-[var(--status-maint-fg)]", iconBg: "bg-[var(--status-maint-bg)]" },
  sterilized: { icon: CheckCircle2, color: "text-[var(--status-steril-fg)]", iconBg: "bg-[var(--status-steril-bg)]" },
  critical: { icon: AlertTriangle, color: "text-[var(--status-issue-fg)]", iconBg: "bg-[var(--status-issue-bg)]" },
  needs_attention: { icon: AlertTriangle, color: "text-[var(--status-maint-fg)]", iconBg: "bg-[var(--status-maint-bg)]" },
  inactive: { icon: Package, color: "text-muted-foreground", iconBg: "bg-muted" },
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
    <Card className="bg-card border-border/60" data-testid="equipment-detail-status-strip">
      <CardContent className="p-3 space-y-2">
        {recoveryCalloutKey && (
          <div
            className="flex items-start gap-2 rounded-lg border-s-4 border-s-[hsl(var(--status-maintenance))] bg-[var(--status-maint-bg)] px-3 py-2 text-sm text-[var(--status-maint-fg)]"
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
              <Badge variant={statusToBadgeVariant(status)} className="text-xs" dot>
                {STATUS_LABELS[status] ?? status}
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
              <p className="text-[var(--status-issue-fg)] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t.equipmentDetail.maintenanceOverdue}
              </p>
            )}
            {sterilizationDue && (
              <p className="text-[var(--status-maint-fg)] flex items-center gap-1.5">
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
