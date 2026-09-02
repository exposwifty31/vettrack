import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Loader2, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Bdi } from "@/components/ui/bdi";
import { cn } from "@/lib/utils";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { t } from "@/lib/i18n";
import type { Equipment, EquipmentStatus } from "@/types";

/**
 * The four human-settable statuses, matching `EquipmentScanStatusDialog` exactly.
 * The server enum also carries derived values (`overdue`, `critical`, `inactive`,
 * `needs_attention`) that the system computes — offering them here would let an
 * operator hand-write a state the system owns.
 */
const SETTABLE: ReadonlyArray<{ value: EquipmentStatus; Icon: typeof CheckCircle2 }> = [
  { value: "ok", Icon: CheckCircle2 },
  { value: "issue", Icon: AlertTriangle },
  { value: "maintenance", Icon: Wrench },
  { value: "sterilized", Icon: Sparkles },
];

interface EquipmentStatusSheetProps {
  equipment: Equipment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * In-row status change for the desktop `/equipment` console (Track B).
 *
 * Writes through PATCH, NOT `api.equipment.scan`. The scan path additionally stamps
 * `lastSeen` and inserts a `scanLogs` row — a claim that someone physically saw the
 * item. A manager acting from the console saw nothing, and `lastSeen` feeds the
 * staleness and "missing" counts elsewhere in the product, so routing console edits
 * through `scan` would quietly manufacture presence evidence.
 *
 * Only `status` is sent: an omitted key is preserved server-side, so a single-field
 * PATCH cannot blank a field the console never loaded.
 */
export function EquipmentStatusSheet({ equipment, open, onOpenChange }: EquipmentStatusSheetProps) {
  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: (status: EquipmentStatus) => api.equipment.update(equipment.id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.console.statusUpdated);
      onOpenChange(false);
    },
    onError: () => toast.error(t.console.statusUpdateFailed),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[75dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="mb-2 border-b border-border/60 pb-3">
          <SheetTitle className="text-base">{t.equipmentDetail.updateStatusTitle}</SheetTitle>
          <p className="truncate text-xs text-muted-foreground">
            <Bdi>{getEquipmentDisplayName(equipment)}</Bdi>
          </p>
        </SheetHeader>

        <div className="flex flex-col gap-0.5 pb-safe">
          {SETTABLE.map(({ value, Icon }) => {
            const isCurrent = equipment.status === value;
            return (
              <button
                key={value}
                type="button"
                disabled={mut.isPending}
                data-testid={`equipment-status-option-${value}`}
                onClick={() => mut.mutate(value)}
                className={cn(
                  "flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 text-start text-sm transition-colors hover:bg-muted/50 disabled:opacity-60",
                  isCurrent && "bg-muted/40 font-semibold",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">{equipmentStatusLabel(value)}</span>
                {mut.isPending && mut.variables === value ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                ) : isCurrent ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
