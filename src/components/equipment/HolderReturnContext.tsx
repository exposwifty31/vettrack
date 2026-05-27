import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils";
import {
  computeHolderReturnEstimate,
  type HolderReturnEstimate,
} from "@/lib/equipment-waitlist-ui";
import type { Equipment } from "@/types";
import { Clock, User } from "lucide-react";

interface HolderReturnContextProps {
  equipment: Equipment;
}

function HolderReturnContextBody({
  equipment,
  estimate,
}: {
  equipment: Equipment;
  estimate: HolderReturnEstimate;
}) {
  const holderLabel = equipment.checkedOutByEmail ?? t.common.unknown;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-start gap-2">
        <User className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
        <p>
          <span className="font-medium">{t.equipmentWaitlist.holderContext.inUse}</span>
          <span className="text-muted-foreground"> — {holderLabel}</span>
        </p>
      </div>

      {estimate.hasEstimate && estimate.expectedReturnAt ? (
        <div className="flex items-start gap-2">
          <Clock className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
          <p data-testid="holder-expected-return">
            {t.equipmentWaitlist.holderContext.expectedReturnAround.replace(
              "{time}",
              formatDateTime(estimate.expectedReturnAt.toISOString()),
            )}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground ps-6" data-testid="holder-no-eta">
          {t.equipmentWaitlist.holderContext.noEstimate}
        </p>
      )}

      {estimate.isOverdue && (
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
          data-testid="holder-return-overdue"
        >
          {t.equipmentWaitlist.holderContext.overdue}
        </Badge>
      )}
    </div>
  );
}

export function HolderReturnContext({ equipment }: HolderReturnContextProps) {
  const estimate = computeHolderReturnEstimate(equipment);

  return (
    <div
      className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3"
      data-testid="equipment-holder-return-context"
    >
      <HolderReturnContextBody equipment={equipment} estimate={estimate} />
    </div>
  );
}
