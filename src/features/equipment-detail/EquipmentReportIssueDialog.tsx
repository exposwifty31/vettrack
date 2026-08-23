import type { Dispatch, RefObject, SetStateAction } from "react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Camera, Loader2 } from "lucide-react";

interface EquipmentReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentDisplayName: string;
  note: string;
  setNote: Dispatch<SetStateAction<string>>;
  noteError: string;
  setNoteError: Dispatch<SetStateAction<string>>;
  photo: string | null;
  setPhoto: Dispatch<SetStateAction<string | null>>;
  photoInputRef: RefObject<HTMLInputElement>;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  isPending: boolean;
}

/** "Report Issue" dialog — a required note plus an optional photo, submitted
 * as a status="issue" scan. Fully controlled: all state and the submit
 * mutation stay owned by the equipment-detail page, this component is
 * presentational only. */
export function EquipmentReportIssueDialog({
  open,
  onOpenChange,
  equipmentDisplayName,
  note,
  setNote,
  noteError,
  setNoteError,
  photo,
  setPhoto,
  photoInputRef,
  onPhotoChange,
  onSubmit,
  isPending,
}: EquipmentReportIssueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.equipmentDetail.reportIssueTitle}</DialogTitle>
          <DialogDescription>{equipmentDisplayName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-issue-note">
              Describe the issue
              <span className="text-[var(--status-issue-fg)] ms-1">*</span>
            </Label>
            <Textarea
              id="report-issue-note"
              placeholder={t.equipmentDetail.describeIssue}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (e.target.value.trim()) setNoteError("");
              }}
              rows={3}
              data-testid="report-issue-note"
              className={noteError ? "border-[var(--status-issue-border)] focus-visible:ring-[var(--status-issue-border)]" : ""}
            />
            {noteError && (
              <p className="text-xs text-[var(--status-issue-fg)] font-medium">{noteError}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Photo
              <span className="text-muted-foreground text-xs ms-1">(optional)</span>
            </Label>
            {photo ? (
              <div className="relative">
                <img
                  src={photo}
                  alt={t.equipmentDetail.issuePhoto}
                  className="w-full h-36 object-cover rounded-xl border-2 border-primary/30"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1 end-1 bg-white/80 text-xs h-11 min-w-[44px]"
                  onClick={() => setPhoto(null)}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 w-full h-24 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:bg-muted/50 transition-colors"
                data-testid="btn-report-issue-photo"
              >
                <Camera className="w-6 h-6" />
                <span className="text-sm font-medium">{t.equipmentDetail.takePhoto}</span>
              </button>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onPhotoChange}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending}
            className="bg-destructive hover:bg-destructive/90 text-white"
            data-testid="btn-confirm-report-issue"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4 me-2" />
            )}
            Submit Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
