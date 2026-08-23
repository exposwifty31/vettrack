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
import { Loader2 } from "lucide-react";

interface EquipmentLockNfcTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: () => void | Promise<void>;
}

/** Irreversible-lock confirmation for an NTAG215 sticker — the lock action
 * itself (`lockEquipmentNfcTag`) stays owned by the equipment-detail page;
 * this component is presentational only. */
export function EquipmentLockNfcTagDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: EquipmentLockNfcTagDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.equipmentNfc.lockConfirmTitle}</DialogTitle>
          <DialogDescription>{t.equipmentNfc.lockConfirmBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={isPending}
          >
            {isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t.equipmentNfc.lockConfirmAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
