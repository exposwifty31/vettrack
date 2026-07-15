import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, BatteryWarning, Plug } from "lucide-react";

export interface ReturnPlugConfirmValues {
  isPluggedIn: boolean;
  plugInDeadlineMinutes?: number;
  /**
   * True only when the caller opts in via `allowDamagedReport` and the user
   * picks the third "Returned damaged" choice (T-24d · R-EQ-F3). Existing
   * plugged/not-plugged callers never set or read this field — additive,
   * non-breaking contract extension.
   */
  damaged?: boolean;
}

interface ReturnPlugDialogProps {
  open: boolean;
  equipmentName?: string;
  pending?: boolean;
  isSubmitting?: boolean;
  defaultDeadlineMinutes?: number;
  /**
   * Opt-in third choice (T-24d) — renders "Damaged" alongside plugged/not
   * plugged. Callers that omit this keep the original two-button grid and
   * behavior untouched.
   */
  allowDamagedReport?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: ReturnPlugConfirmValues) => void;
}

const DEFAULT_DEADLINE_MINUTES = 30;

export interface PlugStatusFieldsProps {
  isPluggedIn: boolean;
  onPluggedInChange: (value: boolean) => void;
  returnedDamaged: boolean;
  onReturnedDamagedChange: (value: boolean) => void;
  deadlineMinutes: number;
  onDeadlineMinutesChange: (value: number) => void;
  defaultDeadlineMinutes: number;
  allowDamagedReport?: boolean;
  isBusy?: boolean;
}

/**
 * The plugged-in / not-plugged / "returned damaged" (T-24d) choice grid +
 * its sub-fields — extracted so `UnifiedReturnDialog` (T2.3 docking P2) can
 * reuse this exact, already-tested UI for its unchecked (plain-return)
 * path without duplicating it. `ReturnPlugDialog` below still owns all the
 * state and the confirm/cancel actions; this component is presentational
 * only.
 */
export function PlugStatusFields({
  isPluggedIn,
  onPluggedInChange,
  returnedDamaged,
  onReturnedDamagedChange,
  deadlineMinutes,
  onDeadlineMinutesChange,
  defaultDeadlineMinutes,
  allowDamagedReport = false,
  isBusy = false,
}: PlugStatusFieldsProps) {
  return (
    <>
      <div className={allowDamagedReport ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
        <Button
          type="button"
          variant={!returnedDamaged && isPluggedIn ? "default" : "outline"}
          className="h-11 gap-2"
          onClick={() => {
            onReturnedDamagedChange(false);
            onPluggedInChange(true);
          }}
          disabled={isBusy}
          data-testid="btn-plugged-yes"
        >
          <Plug className="h-4 w-4" aria-hidden />
          {t.returnPlugDialog.pluggedIn}
        </Button>
        <Button
          type="button"
          variant={!returnedDamaged && !isPluggedIn ? "default" : "outline"}
          className="h-11 gap-2"
          onClick={() => {
            onReturnedDamagedChange(false);
            onPluggedInChange(false);
          }}
          disabled={isBusy}
          data-testid="btn-plugged-no"
        >
          <BatteryWarning className="h-4 w-4" aria-hidden />
          {t.returnPlugDialog.notPluggedIn}
        </Button>
        {allowDamagedReport && (
          <Button
            type="button"
            variant={returnedDamaged ? "destructive" : "outline"}
            className="h-11 gap-2"
            onClick={() => onReturnedDamagedChange(true)}
            disabled={isBusy}
            data-testid="btn-returned-damaged"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {t.returnPlugDialog.damagedButton}
          </Button>
        )}
      </div>

      {!returnedDamaged && !isPluggedIn && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-testid="return-plug-warning">
          {t.returnPlugDialog.plugAlertWarning(deadlineMinutes)}
        </div>
      )}

      {!returnedDamaged && !isPluggedIn && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="plugInDeadlineMinutes">{t.returnPlugDialog.deadlineLabel}</Label>
          <Input
            id="plugInDeadlineMinutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            value={deadlineMinutes}
            onChange={(event) =>
              onDeadlineMinutesChange(parseInt(event.target.value || `${defaultDeadlineMinutes}`, 10))
            }
            disabled={isBusy}
            data-testid="input-plug-deadline"
          />
        </div>
      )}

      {returnedDamaged && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="return-damaged-warning"
        >
          {t.returnPlugDialog.damageWarning}
        </div>
      )}
    </>
  );
}

export function ReturnPlugDialog({
  open,
  equipmentName,
  pending = false,
  isSubmitting = false,
  defaultDeadlineMinutes = DEFAULT_DEADLINE_MINUTES,
  allowDamagedReport = false,
  onOpenChange,
  onConfirm,
}: ReturnPlugDialogProps) {
  const isBusy = pending || isSubmitting;
  const [isPluggedIn, setIsPluggedIn] = useState(true);
  const [returnedDamaged, setReturnedDamaged] = useState(false);
  const [deadlineMinutes, setDeadlineMinutes] = useState(defaultDeadlineMinutes);

  function handleConfirm() {
    if (returnedDamaged) {
      onConfirm({ isPluggedIn, damaged: true });
      return;
    }
    const normalizedDeadline = Math.max(
      1,
      Math.min(1440, Number.isFinite(deadlineMinutes) ? deadlineMinutes : defaultDeadlineMinutes),
    );
    onConfirm({
      isPluggedIn,
      ...(isPluggedIn ? {} : { plugInDeadlineMinutes: normalizedDeadline }),
    });
  }

  function resetState(nextOpen: boolean) {
    if (!nextOpen) {
      setIsPluggedIn(true);
      setReturnedDamaged(false);
      setDeadlineMinutes(defaultDeadlineMinutes);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Sheet open={open} onOpenChange={resetState}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t.returnPlugDialog.title}</SheetTitle>
          <SheetDescription>{t.returnPlugDialog.description(equipmentName)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 py-2">
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
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => resetState(false)} disabled={isBusy}>
            {t.returnPlugDialog.cancel}
          </Button>
          <Button onClick={handleConfirm} disabled={isBusy} data-testid="btn-confirm-return-plug">
            {returnedDamaged
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
