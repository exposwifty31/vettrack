import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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

const RETENTION_DAYS = 90;

function isDeleteBlocked(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export function DeletePatientDialog({
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

  const deleteMut = useMutation({
    mutationFn: () => {
      if (!patient) throw new Error("No patient");
      return api.patients.remove(patient.id, {
        dischargeNotes: notes.trim() || undefined,
        override: blocked && overrideReason.trim().length > 0,
        overrideReason: blocked ? overrideReason.trim() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      toast.success(p.deleteSuccess);
      handleOpenChange(false);
      onSuccess?.();
    },
    onError: (err: unknown) => {
      if (isDeleteBlocked(err)) {
        setBlocked(true);
        return;
      }
      const message = err instanceof Error ? err.message : p.deleteFailed;
      toast.error(message || p.deleteFailed);
    },
  });

  if (!patient) return null;

  const patientName = patient.animal.name;
  const canForce = blocked && overrideReason.trim().length > 0;
  const description = p.deleteDescription
    .replace("{name}", patientName)
    .replace("{days}", String(RETENTION_DAYS));

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            {p.deleteTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {blocked ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-sm font-medium text-foreground">{p.deleteBlockedTitle}</p>
            <p className="text-xs text-muted-foreground">{p.deleteBlockedMessage}</p>
            <div className="space-y-1.5">
              <Label htmlFor="delete-override-reason" className="text-sm">
                {p.deleteOverrideLabel}
              </Label>
              <Textarea
                id="delete-override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={p.deleteOverridePlaceholder}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="delete-notes" className="text-sm">
              {p.deleteNotesLabel}
            </Label>
            <Textarea
              id="delete-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={p.deleteNotesPlaceholder}
              rows={3}
              className="resize-none"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMut.isPending}>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleteMut.isPending || (blocked && !canForce)}
            onClick={(e) => {
              e.preventDefault();
              deleteMut.mutate();
            }}
            className="bg-destructive hover:bg-destructive/90"
            data-testid="btn-confirm-delete-patient"
          >
            {deleteMut.isPending
              ? p.deleting
              : blocked
                ? p.deleteForceConfirm
                : p.deleteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
