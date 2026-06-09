import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ORPHAN_DRUG_ALERTS_QUERY_KEY } from "@/lib/event-reducer";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CopAlertEntry } from "@/types/cop-alerts";

/** Stable fallback — `useSyncExternalStore` requires referentially stable snapshots when data is unchanged. */
const EMPTY_COP_ALERTS: CopAlertEntry[] = [];

function labelFor(entry: CopAlertEntry): string {
  if (entry.variant === "order_mismatch") {
    return t.cop.discrepancySubtitle;
  }
  if (entry.variant === "charged_no_admin") {
    return t.cop.chargedNoAdminDetail({
      billingId: entry.billingLedgerId ?? "—",
      hours: entry.hoursSinceCharge ?? 0,
    });
  }
  return t.cop.adminNoDispenseDetail({
    taskId: entry.taskId ?? "—",
    hours: entry.hoursSinceAdmin ?? 0,
  });
}

/** Surfaces Smart Cop orphan / mismatch alerts populated via realtime (`event-reducer`). */
export function CopDiscrepancyBanner() {
  const qc = useQueryClient();

  const alerts = useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    () => qc.getQueryData<CopAlertEntry[]>(ORPHAN_DRUG_ALERTS_QUERY_KEY) ?? EMPTY_COP_ALERTS,
    () => EMPTY_COP_ALERTS,
  );

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {alerts.slice(0, 5).map((entry) => (
        <div
          key={entry.eventId}
          className={cn(
            "flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-xs",
            entry.variant === "order_mismatch"
              ? "border-amber-500/35 bg-amber-500/[0.06]"
              : "border-destructive/35 bg-destructive/[0.06]",
          )}
        >
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold">{t.cop.discrepancyTitle}</div>
            <div className="text-muted-foreground">{labelFor(entry)}</div>
          </div>
          {entry.dismissable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => {
                qc.setQueryData<CopAlertEntry[]>(ORPHAN_DRUG_ALERTS_QUERY_KEY, (prev) =>
                  (prev ?? []).filter((x) => x.eventId !== entry.eventId),
                );
              }}
            >
              {t.cop.dismiss}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
