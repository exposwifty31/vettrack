import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable E) — reject requires a reason. The
 * server enforces `rejectionReason.min(1)`
 * (`rejectActionProposalBodySchema`); this dialog gates submit on a
 * non-whitespace reason client-side so the request never round-trips for an
 * obviously-empty reason, and trims before submitting.
 */
export interface RejectReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}

export function RejectReasonDialog({ open, onOpenChange, onSubmit, pending }: RejectReasonDialogProps) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  function handleOpenChange(next: boolean) {
    if (!next) setReason("");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="reject-reason-dialog">
        <DialogHeader>
          <DialogTitle>{t.autopilotQueue.rejectDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="autopilot-reject-reason">{t.autopilotQueue.rejectReasonLabel}</Label>
          <Textarea
            id="autopilot-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
          />
          {reason.length > 0 && trimmed.length === 0 && (
            <p className="text-xs text-destructive">{t.autopilotQueue.rejectReasonRequired}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {t.autopilotQueue.rejectCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onSubmit(trimmed)}
            disabled={trimmed.length === 0 || pending}
          >
            {t.autopilotQueue.rejectSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
