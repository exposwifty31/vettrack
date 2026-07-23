import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable E) — v1 disclosed scope: a
 * structured edit dialog exists ONLY for `restock_po_on_burn`
 * (`RestockEditDialog`). The other 3 kinds' edit button opens this
 * confirm-style explainer instead of doing nothing silently.
 */
export function EditUnavailableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-unavailable-dialog">
        <DialogHeader>
          <DialogTitle>{t.autopilotQueue.editUnavailableTitle}</DialogTitle>
          <DialogDescription>{t.autopilotQueue.editUnavailableBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t.autopilotQueue.editUnavailableDismiss}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
