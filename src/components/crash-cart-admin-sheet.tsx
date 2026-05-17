// src/components/crash-cart-admin-sheet.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type CrashCartItem } from "@/types";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

type ItemForm = { key: string; label: string; requiredQty: number; expiryWarnDays: string };
const BLANK_FORM: ItemForm = { key: "", label: "", requiredQty: 1, expiryWarnDays: "" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CrashCartAdminSheet({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CrashCartItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrashCartItem | null>(null);
  const [form, setForm] = useState<ItemForm>(BLANK_FORM);

  const itemsQ = useQuery({
    queryKey: ["/api/crash-cart/items"],
    queryFn: () => api.crashCartItems.list(),
    enabled: open,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.crashCartItems.create({
        key: form.key.trim(),
        label: form.label.trim(),
        requiredQty: form.requiredQty,
        expiryWarnDays: form.expiryWarnDays ? parseInt(form.expiryWarnDays) : null,
      }),
    onSuccess: () => {
      toast.success(t.admin.crashCart.toast.added);
      qc.invalidateQueries({ queryKey: ["/api/crash-cart/items"] });
      setFormOpen(false);
    },
    onError: (err: unknown) => {
      const msg = String((err as { message?: string })?.message ?? "");
      if (msg.includes("409") || msg.includes("KEY_EXISTS")) toast.error(t.admin.crashCart.toast.keyExists);
      else toast.error(t.admin.crashCart.toast.addFailed);
    },
  });

  const updateMut = useMutation({
    mutationFn: () =>
      api.crashCartItems.update(editTarget!.id, {
        label: form.label.trim(),
        requiredQty: form.requiredQty,
        expiryWarnDays: form.expiryWarnDays ? parseInt(form.expiryWarnDays) : null,
      }),
    onSuccess: () => {
      toast.success(t.admin.crashCart.toast.updated);
      qc.invalidateQueries({ queryKey: ["/api/crash-cart/items"] });
      setFormOpen(false);
    },
    onError: () => toast.error(t.admin.crashCart.toast.updateFailed),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.crashCartItems.remove(id),
    onSuccess: () => {
      toast.success(t.admin.crashCart.toast.removed);
      qc.invalidateQueries({ queryKey: ["/api/crash-cart/items"] });
      setDeleteTarget(null);
    },
    onError: () => toast.error(t.admin.crashCart.toast.removeFailed),
  });

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK_FORM);
    setFormOpen(true);
  }

  function openEdit(item: CrashCartItem) {
    setEditTarget(item);
    setForm({
      key: item.key,
      label: item.label,
      requiredQty: item.requiredQty,
      expiryWarnDays: item.expiryWarnDays != null ? String(item.expiryWarnDays) : "",
    });
    setFormOpen(true);
  }

  function handleSave() {
    if (editTarget) updateMut.mutate();
    else createMut.mutate();
  }

  const isPending = editTarget ? updateMut.isPending : createMut.isPending;
  const items = itemsQ.data ?? [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[80dvh] flex flex-col p-0" dir="rtl">
          <SheetHeader className="px-4 pt-5 pb-3 border-b">
            <SheetTitle>{t.admin.crashCart.title}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {itemsQ.isPending ? (
              <p className="text-sm text-muted-foreground p-4">{t.admin.crashCart.loading}</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">{t.admin.crashCart.emptyMessage}</p>
            ) : (
              <div className="divide-y">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {t.admin.crashCart.itemSubtitle(item.key, item.requiredQty)}
                        {item.expiryWarnDays ? t.admin.crashCart.expiryWarnSuffix(item.expiryWarnDays) : ""}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border-t" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <Button onClick={openCreate} className="w-full" size="sm">
              <Plus className="h-4 w-4 ml-1" />
              {t.admin.crashCart.addItem}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editTarget ? t.admin.crashCart.editTitle : t.admin.crashCart.newTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{t.admin.crashCart.fieldKey}</Label>
              <Input
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
                disabled={!!editTarget}
                placeholder="epinephrine"
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <Label>{t.admin.crashCart.fieldLabel}</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder={t.admin.crashCart.labelPlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label>{t.admin.crashCart.fieldQtyRequired}</Label>
              <Input
                type="number"
                min={1}
                value={form.requiredQty}
                onChange={(e) => setForm((f) => ({ ...f, requiredQty: Math.max(1, parseInt(e.target.value) || 1) }))}
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <Label>{t.admin.crashCart.fieldExpiryWarn}</Label>
              <Input
                type="number"
                min={1}
                value={form.expiryWarnDays}
                onChange={(e) => setForm((f) => ({ ...f, expiryWarnDays: e.target.value }))}
                placeholder="30"
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleSave} disabled={isPending || !form.label.trim() || !form.key.trim()}>
              {isPending ? t.admin.crashCart.saving : t.admin.crashCart.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.admin.crashCart.removeConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.admin.crashCart.removeConfirmDesc(deleteTarget?.label ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.admin.crashCart.removeAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
