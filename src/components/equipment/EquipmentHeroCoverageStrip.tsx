import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ChevronRight } from "lucide-react";

interface EquipmentHeroCoverageStripProps {
  recoveryAttentionCount: number;
  onFilterNeedsAttention: () => void;
  onOpenRoomSweep: () => void;
  recoveryFilterActive: boolean;
  showRoomSweep?: boolean;
}

export function EquipmentHeroCoverageStrip({
  recoveryAttentionCount,
  onFilterNeedsAttention,
  onOpenRoomSweep,
  recoveryFilterActive,
  showRoomSweep = true,
}: EquipmentHeroCoverageStripProps) {
  const showRecovery = recoveryAttentionCount > 0;

  return (
    <div className="flex flex-col gap-2" data-testid="equipment-hero-coverage-strip">
      {showRoomSweep && (
        <Button
          type="button"
          variant="outline"
          className="w-full h-11 justify-between"
          onClick={onOpenRoomSweep}
          data-testid="equipment-hero-room-sweep"
        >
          <span>{t.equipmentTruth.roomSweepButton}</span>
          <ChevronRight className="w-4 h-4" />
        </Button>
      )}
      {showRecovery && (
        <Card className="border-amber-200/80 bg-amber-50/90 dark:bg-amber-950/40 dark:border-amber-800/60">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                  {t.equipmentTruth.coverageAttentionTitle}
                </p>
                <p className="text-xs text-amber-900/80 dark:text-amber-200/80 mt-0.5">
                  {t.equipmentList.recoveryAttentionSummary.replace(
                    "{count}",
                    String(recoveryAttentionCount),
                  )}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant={recoveryFilterActive ? "default" : "outline"}
              className="shrink-0 h-10"
              onClick={onFilterNeedsAttention}
              data-testid="equipment-hero-filter-attention"
            >
              {recoveryFilterActive
                ? t.equipmentTruth.coverageFilterActive
                : t.equipmentTruth.coverageShowOnly}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
