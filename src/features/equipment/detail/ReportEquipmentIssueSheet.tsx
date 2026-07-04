import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import type { Equipment } from "@/types";

type Props = {
  equipment: Equipment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Minimal equipment-issue report for the slim native detail (Phase 7 #1).
 * The scanner's "Mark Issue" deep-links `/equipment/:id?action=issue`, which
 * only the desktop page used to read — on native the button silently no-oped.
 * Submits the same scan-status-`issue` path the desktop dialog uses; the
 * desktop-only extras (photo attach, undo timer, WhatsApp share) stay there.
 */
export function ReportEquipmentIssueSheet({ equipment, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const reportMut = useMutation({
    mutationFn: () => api.equipment.scan(equipment.id, { status: "issue", note }),
    onSuccess: (res) => {
      haptics.tap();
      queryClient.setQueryData([`/api/equipment/${equipment.id}`], res.equipment);
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}/logs`] });
      setNote("");
      onOpenChange(false);
      toast.success(
        res.pendingSyncId !== undefined
          ? t.equipmentDetail.toast.savedOffline
          : t.equipmentDetail.toast.issueReported,
      );
    },
    onError: (err: Error) => {
      toast.error(t.equipmentDetail.toast.reportFailed(err.message));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() || reportMut.isPending) return;
    reportMut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.equipmentDetail.reportIssueTitle}</DialogTitle>
          <DialogDescription>{getEquipmentDisplayName(equipment)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slim-report-issue-note">
              {t.equipmentDetail.describeIssue}
              <span className="text-[var(--status-issue-fg)] ms-1">*</span>
            </Label>
            <Textarea
              id="slim-report-issue-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              required
              data-testid="slim-report-issue-note"
            />
          </div>
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={reportMut.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={!note.trim() || reportMut.isPending}
              data-testid="btn-slim-submit-issue"
            >
              {reportMut.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t.equipmentDetail.reportIssueTitle}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
