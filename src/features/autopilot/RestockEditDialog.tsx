import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

export interface RestockEditLine {
  itemId: string;
  quantitySuggested: number;
}

export interface RestockEditDraftContent {
  supplierName: string;
  lines: RestockEditLine[];
}

export interface RestockEditedContent {
  supplierName: string;
  lines: RestockEditLine[];
}

export interface RestockEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftContent: RestockEditDraftContent;
  onSubmit: (editedContent: RestockEditedContent) => void;
  pending: boolean;
}

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable E) — the one structured edit
 * dialog built for v1, restock kind only. Shape matches
 * `restockPoOnBurnEditedContentSchema` exactly (`server/lib/autopilot/
 * action-proposal-types.ts`) so the server's per-kind Zod never rejects a
 * client-produced edit. Every other kind gets the generic
 * "edit-in-console-coming" dialog instead (`EditUnavailableDialog`).
 */
export function RestockEditDialog({ open, onOpenChange, draftContent, onSubmit, pending }: RestockEditDialogProps) {
  const [supplierName, setSupplierName] = useState(draftContent.supplierName);
  const [lines, setLines] = useState<RestockEditLine[]>(draftContent.lines);
  const [error, setError] = useState(false);

  function setQuantity(itemId: string, raw: string): void {
    const parsed = Number(raw);
    setLines((prev) =>
      prev.map((line) => (line.itemId === itemId ? { ...line, quantitySuggested: parsed } : line)),
    );
  }

  function isValid(): boolean {
    if (supplierName.trim().length === 0) return false;
    if (lines.length === 0) return false;
    return lines.every((line) => Number.isInteger(line.quantitySuggested) && line.quantitySuggested > 0);
  }

  function handleSubmit(): void {
    if (!isValid()) {
      setError(true);
      return;
    }
    setError(false);
    onSubmit({ supplierName: supplierName.trim(), lines });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="restock-edit-dialog">
        <DialogHeader>
          <DialogTitle>{t.autopilotQueue.editRestock.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="autopilot-restock-supplier">{t.autopilotQueue.editRestock.supplierLabel}</Label>
            <Input
              id="autopilot-restock-supplier"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.itemId} className="flex items-center gap-2">
                <Label htmlFor={`autopilot-restock-qty-${line.itemId}`} className="min-w-0 flex-1 truncate">
                  {t.autopilotQueue.editRestock.lineItemLabel}: {line.itemId}
                </Label>
                <Input
                  id={`autopilot-restock-qty-${line.itemId}`}
                  type="number"
                  min={1}
                  className="w-20"
                  value={line.quantitySuggested}
                  onChange={(e) => setQuantity(line.itemId, e.target.value)}
                  disabled={pending}
                  aria-label={`${t.autopilotQueue.editRestock.quantityLabel} — ${line.itemId}`}
                />
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-destructive">{t.autopilotQueue.editRestock.invalid}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.autopilotQueue.editRestock.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {t.autopilotQueue.editRestock.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
