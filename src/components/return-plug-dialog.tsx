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
          <SheetTitle>Return Equipment</SheetTitle>
          <SheetDescription>
            {equipmentName
              ? `Was "${equipmentName}" plugged in after returning?`
              : "Was the equipment plugged in after returning?"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className={allowDamagedReport ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
            <Button
              type="button"
              variant={!returnedDamaged && isPluggedIn ? "default" : "outline"}
              className="h-11 gap-2"
              onClick={() => {
                setReturnedDamaged(false);
                setIsPluggedIn(true);
              }}
              disabled={isBusy}
              data-testid="btn-plugged-yes"
            >
              <Plug className="h-4 w-4" aria-hidden />
              Plugged In
            </Button>
            <Button
              type="button"
              variant={!returnedDamaged && !isPluggedIn ? "default" : "outline"}
              className="h-11 gap-2"
              onClick={() => {
                setReturnedDamaged(false);
                setIsPluggedIn(false);
              }}
              disabled={isBusy}
              data-testid="btn-plugged-no"
            >
              <BatteryWarning className="h-4 w-4" aria-hidden />
              Not Plugged In
            </Button>
            {allowDamagedReport && (
              <Button
                type="button"
                variant={returnedDamaged ? "destructive" : "outline"}
                className="h-11 gap-2"
                onClick={() => setReturnedDamaged(true)}
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
              An alert will be sent after {deadlineMinutes} minute{deadlineMinutes !== 1 ? "s" : ""} if not plugged in.
            </div>
          )}

          {!returnedDamaged && !isPluggedIn && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="plugInDeadlineMinutes">Alert deadline (minutes)</Label>
              <Input
                id="plugInDeadlineMinutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={deadlineMinutes}
                onChange={(event) =>
                  setDeadlineMinutes(parseInt(event.target.value || `${defaultDeadlineMinutes}`, 10))
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
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => resetState(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isBusy} data-testid="btn-confirm-return-plug">
            {returnedDamaged
              ? t.returnPlugDialog.confirmReturnedDamaged
              : isPluggedIn
                ? "Confirm — Plugged In ✓"
                : "Set Alert & Return"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
