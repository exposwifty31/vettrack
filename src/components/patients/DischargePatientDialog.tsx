import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Hospitalization } from "@/types";

function isDischargeBlocked(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export function DischargePatientDialog({
  patient,
  open,
  onOpenChange,
  onSuccess,
}: {
  patient: Hospitalization | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const p = t.patientsPage;
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  function resetForm() {
    setNotes("");
    setBlocked(false);
    setOverrideReason("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  const dischargeMut = useMutation({
    mutationFn: () => {
      if (!patient) throw new Error("No patient");
      return api.patients.discharge(patient.id, {
        dischargeNotes: notes.trim() || undefined,
        override: blocked && overrideReason.trim().length > 0,
        overrideReason: blocked ? overrideReason.trim() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      toast.success(p.dischargeSuccess);
      handleOpenChange(false);
      onSuccess?.();
    },
    onError: (err: unknown) => {
      if (isDischargeBlocked(err)) {
        setBlocked(true);
        return;
      }
      const message = err instanceof Error ? err.message : p.dischargeFailed;
      toast.error(message || p.dischargeFailed);
    },
  });

  if (!patient) return null;

  const patientName = patient.animal.name;
  const canForce = blocked && overrideReason.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-muted-foreground" />
            {p.dischargeTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {p.dischargeDescription.replace("{name}", patientName)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {blocked ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-sm font-medium text-foreground">{p.dischargeBlockedTitle}</p>
            <p className="text-xs text-muted-foreground">{p.dischargeBlockedMessage}</p>
            <div className="space-y-1.5">
              <Label htmlFor="discharge-override-reason" className="text-sm">
                {p.dischargeOverrideLabel}
              </Label>
              <Textarea
                id="discharge-override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={p.dischargeOverridePlaceholder}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="discharge-notes" className="text-sm">
              {p.dischargeNotesLabel}
            </Label>
            <Textarea
              id="discharge-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={p.dischargeNotesPlaceholder}
              rows={3}
              className="resize-none"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={dischargeMut.isPending}>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={dischargeMut.isPending || (blocked && !canForce)}
            onClick={(e) => {
              e.preventDefault();
              dischargeMut.mutate();
            }}
            className={blocked ? "bg-destructive hover:bg-destructive/90" : undefined}
            data-testid="btn-confirm-discharge-patient"
          >
            {dischargeMut.isPending
              ? p.discharging
              : blocked
                ? p.dischargeForceConfirm
                : p.dischargeConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
