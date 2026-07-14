import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConditionChecklist } from "@/components/equipment/ConditionChecklist";
import { PlugStatusFields, type ReturnPlugConfirmValues } from "@/components/return-plug-dialog";
import { resolveHomeDock } from "@/lib/dock-resolution";
import type { Equipment } from "@/types";

export type { ReturnPlugConfirmValues };

interface ConditionEntry {
  conditionId: string;
  verified: boolean;
  notes?: string;
}

export interface UnifiedReturnDialogProps {
  open: boolean;
  equipment: Equipment;
  equipmentName?: string;
  isSubmitting?: boolean;
  defaultDeadlineMinutes?: number;
  /** Opt-in third "Damaged" choice on the unchecked (plain-return) path — forwarded to PlugStatusFields (T-24d). */
  allowDamagedReport?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unchecked (plain-return) path — same contract as ReturnPlugDialog.onConfirm; the caller owns the custody-return mutation. */
  onConfirmReturn: (values: ReturnPlugConfirmValues) => void;
  /** Checked (dock-return) path succeeded — the dialog already closed and invalidated its own docking caches; use this to refresh broader page caches. */
  onDockReturnSuccess?: () => void;
}

const DEFAULT_DEADLINE_MINUTES = 30;

/**
 * T2.3 (docking P2) — unified return dialog. Collapses the plain "Return"
 * and separate "Dock return" quick actions behind one home-station toggle:
 *   - Checked   → dock-return endpoint (writes the docking anchor, T2.4);
 *     asset-typed items still run the condition quick-check
 *     (`ConditionChecklist`, reused from `DockReturnFlow`).
 *   - Unchecked → plain custody return, reusing `PlugStatusFields` (the
 *     plugged-in / plug-deadline / "returned damaged" controls extracted
 *     from `ReturnPlugDialog`) verbatim.
 *
 * The home dock is derived client-side by matching `equipment.homeRoomId` +
 * `equipment.assetTypeId` against `api.operationalState.listDocks()` (see
 * `resolveHomeDock` — a hand-kept mirror of the server-side function of the
 * same name, since `src/` must not import from `server/`).
 */
export function UnifiedReturnDialog({
  open,
  equipment,
  equipmentName,
  isSubmitting = false,
  defaultDeadlineMinutes = DEFAULT_DEADLINE_MINUTES,
  allowDamagedReport = false,
  onOpenChange,
  onConfirmReturn,
  onDockReturnSuccess,
}: UnifiedReturnDialogProps) {
  const queryClient = useQueryClient();
  const hasHomeRoom = Boolean(equipment.homeRoomId);

  const [dockToggleOn, setDockToggleOn] = useState(hasHomeRoom);
  const [isPluggedIn, setIsPluggedIn] = useState(true);
  const [returnedDamaged, setReturnedDamaged] = useState(false);
  const [deadlineMinutes, setDeadlineMinutes] = useState(defaultDeadlineMinutes);
  const [verifications, setVerifications] = useState<ConditionEntry[]>([]);

  // I-1 (P2 review) — dock-return is a server at-station assertion; it
  // genuinely cannot happen offline. `dockToggleOn` stays the raw user-intent
  // state, but every behavioral read routes through `effectiveDockOn` so an
  // offline (or no-home) return always falls back to the offline-capable
  // plain return instead of the online-only dockReturn endpoint.
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const canDock = hasHomeRoom && isOnline;
  const effectiveDockOn = dockToggleOn && canDock;

  const docksQ = useQuery({
    queryKey: ["/api/docks"],
    queryFn: api.operationalState.listDocks,
    enabled: open,
  });

  const resolvedDock = useMemo(
    () =>
      resolveHomeDock(
        { homeRoomId: equipment.homeRoomId ?? null, assetTypeId: equipment.assetTypeId ?? null },
        docksQ.data ?? [],
      ),
    [docksQ.data, equipment.homeRoomId, equipment.assetTypeId],
  );

  const conditionsQ = useQuery({
    queryKey: ["/api/asset-types", equipment.assetTypeId, "conditions"],
    // Non-null: query is gated by `enabled: ... && !!equipment.assetTypeId` above.
    queryFn: () => api.operationalState.listConditions(equipment.assetTypeId!),
    enabled: open && effectiveDockOn && !!equipment.assetTypeId,
  });
  const conditionStatesQ = useQuery({
    queryKey: ["condition-states", equipment.id],
    queryFn: () => api.operationalState.conditionStates(equipment.id),
    enabled: open && effectiveDockOn && !!equipment.assetTypeId,
  });

  const dockReturnMut = useMutation({
    mutationFn: () =>
      // Non-null: only invoked from handleConfirm's `if (!resolvedDock) return;`
      // guard, and the confirm button is disabled while resolvedDock is unset.
      api.operationalState.dockReturn(equipment.id, {
        dockId: resolvedDock!.id,
        conditionVerifications: verifications,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}`] });
      queryClient.invalidateQueries({ queryKey: ["deployability", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["condition-states", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue", equipment.id] });
      toast.success(t.dockReturn.success);
      resetState(false);
      onDockReturnSuccess?.();
    },
    onError: (err) => toast.error(err instanceof Error && err.message ? err.message : t.dockReturn.notReadyAfterReturn),
  });

  const isBusy = isSubmitting || dockReturnMut.isPending;

  function resetState(nextOpen: boolean) {
    if (!nextOpen) {
      setDockToggleOn(hasHomeRoom);
      setIsPluggedIn(true);
      setReturnedDamaged(false);
      setDeadlineMinutes(defaultDeadlineMinutes);
      setVerifications([]);
    }
    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    if (effectiveDockOn) {
      if (!resolvedDock) return;
      dockReturnMut.mutate();
      return;
    }
    if (returnedDamaged) {
      onConfirmReturn({ isPluggedIn, damaged: true });
      return;
    }
    const normalizedDeadline = Math.max(
      1,
      Math.min(1440, Number.isFinite(deadlineMinutes) ? deadlineMinutes : defaultDeadlineMinutes),
    );
    onConfirmReturn({
      isPluggedIn,
      ...(isPluggedIn ? {} : { plugInDeadlineMinutes: normalizedDeadline }),
    });
  }

  const conditions = conditionsQ.data ?? [];
  const existingStates = conditionStatesQ.data ?? [];

  return (
    <Sheet open={open} onOpenChange={resetState}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t.returnPlugDialog.title}</SheetTitle>
          <SheetDescription>{t.returnPlugDialog.description(equipmentName)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 py-2">
          <div
            className={
              effectiveDockOn
                ? "flex items-start gap-3 rounded-lg border border-[rgb(var(--sys-blue)/0.3)] bg-[rgb(var(--sys-blue)/0.08)] p-3"
                : "flex items-start gap-3 rounded-lg border p-3"
            }
          >
            <Checkbox
              id="unified-return-dock-toggle"
              checked={effectiveDockOn}
              disabled={isBusy || !canDock}
              onCheckedChange={(checked) => setDockToggleOn(Boolean(checked))}
              data-testid="toggle-return-to-station"
            />
            <div className="flex-1 min-w-0">
              <Label
                htmlFor="unified-return-dock-toggle"
                className={effectiveDockOn ? "text-sm font-medium cursor-pointer text-[rgb(var(--sys-blue))]" : "text-sm font-medium cursor-pointer"}
              >
                {resolvedDock
                  ? t.returnPlugDialog.toggleLabelStation(resolvedDock.name)
                  : t.returnPlugDialog.toggleLabelGeneric}
              </Label>
              {!hasHomeRoom && (
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="unified-return-no-home-hint">
                  {t.returnPlugDialog.noHomeHint}
                </p>
              )}
              {hasHomeRoom && !isOnline && (
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="unified-return-offline-hint">
                  {t.returnPlugDialog.offlineDockHint}
                </p>
              )}
            </div>
          </div>

          {effectiveDockOn ? (
            <div className="flex flex-col gap-2" data-testid="unified-return-dock-body">
              {!resolvedDock ? (
                <p className="text-xs text-[var(--status-stale-fg)]" data-testid="unified-return-dock-unresolved-hint">
                  {t.returnPlugDialog.stationUnresolvedHint}
                </p>
              ) : conditions.length === 0 ? (
                <p className="text-xs text-[var(--status-stale-fg)]">{t.dockReturn.noConditionsWarning}</p>
              ) : (
                <ConditionChecklist
                  conditions={conditions}
                  existingStates={existingStates}
                  value={verifications}
                  onChange={setVerifications}
                />
              )}
            </div>
          ) : (
            <PlugStatusFields
              isPluggedIn={isPluggedIn}
              onPluggedInChange={setIsPluggedIn}
              returnedDamaged={returnedDamaged}
              onReturnedDamagedChange={setReturnedDamaged}
              deadlineMinutes={deadlineMinutes}
              onDeadlineMinutesChange={setDeadlineMinutes}
              defaultDeadlineMinutes={defaultDeadlineMinutes}
              allowDamagedReport={allowDamagedReport}
              isBusy={isBusy}
            />
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => resetState(false)} disabled={isBusy}>
            {t.returnPlugDialog.cancel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isBusy || (effectiveDockOn && !resolvedDock)}
            data-testid="btn-confirm-return-plug"
          >
            {effectiveDockOn
              ? t.dockReturn.submit
              : returnedDamaged
                ? t.returnPlugDialog.confirmReturnedDamaged
                : isPluggedIn
                  ? t.returnPlugDialog.confirmPluggedIn
                  : t.returnPlugDialog.confirmSetAlert}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
