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
import type { EquipmentStatus } from "@/types";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import {
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Droplets,
  Camera,
  ClipboardEdit,
  Loader2,
} from "lucide-react";

interface EquipmentScanStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentDisplayName: string;
  scanStatus: EquipmentStatus;
  setScanStatus: Dispatch<SetStateAction<EquipmentStatus>>;
  scanNote: string;
  setScanNote: Dispatch<SetStateAction<string>>;
  scanPhoto: string | null;
  setScanPhoto: Dispatch<SetStateAction<string | null>>;
  noteError: string;
  setNoteError: Dispatch<SetStateAction<string>>;
  photoInputRef: RefObject<HTMLInputElement>;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  isPending: boolean;
}

/** "Update Status" dialog — logs a status scan (ok/issue/maintenance/sterilized)
 * with an optional note and, for issues, a photo. Fully controlled: all state
 * and the submit mutation stay owned by the equipment-detail page (shared with
 * the NFC post-scan action sheet's "report issue" trigger), this component is
 * presentational only. */
export function EquipmentScanStatusDialog({
  open,
  onOpenChange,
  equipmentDisplayName,
  scanStatus,
  setScanStatus,
  scanNote,
  setScanNote,
  scanPhoto,
  setScanPhoto,
  noteError,
  setNoteError,
  photoInputRef,
  onPhotoChange,
  onSubmit,
  isPending,
}: EquipmentScanStatusDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.equipmentDetail.updateStatusTitle}</DialogTitle>
          <DialogDescription>Log status for: {equipmentDisplayName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t.equipmentDetail.statusLabel}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["ok", "issue", "maintenance", "sterilized"] as EquipmentStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setScanStatus(s);
                    if (s !== "issue") setNoteError("");
                  }}
                  className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    scanStatus === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/30"
                  }`}
                  data-testid={`scan-status-${s}`}
                >
                  {s === "ok" && <CheckCircle2 className="w-4 h-4 text-[var(--status-ok-fg)]" />}
                  {s === "issue" && <AlertTriangle className="w-4 h-4 text-[var(--status-issue-fg)]" />}
                  {s === "maintenance" && <Wrench className="w-4 h-4 text-[var(--status-maint-fg)]" />}
                  {s === "sterilized" && <Droplets className="w-4 h-4 text-teal-500" />}
                  {equipmentStatusLabel(s)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">
              Note
              {scanStatus === "issue" && (
                <span className="text-[var(--status-issue-fg)] ms-1">*</span>
              )}
              {scanStatus !== "issue" && (
                <span className="text-muted-foreground text-xs ms-1">(optional)</span>
              )}
            </Label>
            <Textarea
              id="note"
              placeholder={
                scanStatus === "issue"
                  ? t.equipmentDetail.describeIssue
                  : t.equipmentDetail.addObservations
              }
              value={scanNote}
              onChange={(e) => {
                setScanNote(e.target.value);
                if (e.target.value.trim()) setNoteError("");
              }}
              rows={3}
              data-testid="scan-note"
              className={noteError ? "border-[var(--status-issue-border)] focus-visible:ring-[var(--status-issue-border)]" : ""}
            />
            {noteError && (
              <p className="text-xs text-[var(--status-issue-fg)] font-medium">{noteError}</p>
            )}
          </div>

          {/* Photo — shown prominently for issues, available for all */}
          {scanStatus === "issue" && (
            <div className="flex flex-col gap-1.5">
              <Label>
                Photo
                <span className="text-muted-foreground text-xs ms-1">(strongly recommended)</span>
              </Label>
              {scanPhoto ? (
                <div className="relative">
                  <img
                    src={scanPhoto}
                    alt={t.equipmentDetail.issuePhoto}
                    className="w-full h-36 object-cover rounded-xl border-2 border-primary/30"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 end-1 bg-white/80 text-xs h-11 min-w-[44px]"
                    onClick={() => setScanPhoto(null)}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 w-full h-24 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:bg-muted/50 transition-colors"
                  data-testid="btn-photo"
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
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending}
            data-testid="btn-confirm-scan"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
            ) : (
              <ClipboardEdit className="w-4 h-4 me-2" />
            )}
            Log Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
