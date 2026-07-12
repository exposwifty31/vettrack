// Not using `Layout` navigationLocked; if that is added, wrap tappable regions with [data-restock-allow] (see layout.tsx).
import { t } from "@/lib/i18n";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorCard } from "@/components/ui/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { type InventoryItem, INVENTORY_ITEM_CATEGORIES } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { Archive, Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type FormState = { code: string; label: string; category: string; nfcTagId: string; isBillable: boolean; minimumDispenseToCapture: number; parLevel: string; reorderPoint: string };
const BLANK: FormState = { code: "", label: "", category: "", nfcTagId: "", isBillable: true, minimumDispenseToCapture: 1, parLevel: "", reorderPoint: "" };

/** Empty string → null (untracked); otherwise a non-negative integer. */
function parseOptCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Math.max(0, parseInt(trimmed, 10) || 0);
}

export default function InventoryItemsPage() {
  const qc = useQueryClient();
  const p = t.inventoryItemsPage;
  const { userId, role } = useAuth();
  const isAdmin = role === "admin";

  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);

  const itemsQ = useQuery({
    queryKey: ["/api/inventory-items"],
    queryFn: () => api.inventoryItems.list(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (itemsQ.data ?? []).filter(
      (item) => item.label.toLowerCase().includes(q) || item.code.toLowerCase().includes(q),
    );
  }, [itemsQ.data, search]);

  // Group by category; uncategorised items land in "Other"
  const grouped = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const item of filtered) {
      const cat = item.category ?? "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    // Sort: known categories first (in order), then any unknown strings alphabetically
    const known = INVENTORY_ITEM_CATEGORIES as readonly string[];
    return [...map.entries()].sort(([a], [b]) => {
      const ai = known.indexOf(a);
      const bi = known.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  function toggleCategory(cat: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK);
    setFormOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditTarget(item);
    setForm({ code: item.code, label: item.label, category: item.category ?? "", nfcTagId: item.nfcTagId ?? "", isBillable: item.isBillable, minimumDispenseToCapture: item.minimumDispenseToCapture, parLevel: item.parLevel != null ? String(item.parLevel) : "", reorderPoint: item.reorderPoint != null ? String(item.reorderPoint) : "" });
    setFormOpen(true);
  }

  const createMut = useMutation({
    mutationFn: () =>
      api.inventoryItems.create({
        code: form.code.trim(),
        label: form.label.trim(),
        category: form.category || undefined,
        nfcTagId: form.nfcTagId.trim() || undefined,
        isBillable: form.isBillable,
        minimumDispenseToCapture: form.minimumDispenseToCapture,
        parLevel: parseOptCount(form.parLevel),
        reorderPoint: parseOptCount(form.reorderPoint),
      }),
    onSuccess: () => {
      toast.success(p.itemCreated);
      qc.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      setFormOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("409") || msg.includes("CODE_EXISTS")) toast.error(p.codeExists);
      else toast.error(p.itemCreateFailed);
    },
  });

  const updateMut = useMutation({
    mutationFn: () =>
      api.inventoryItems.update(editTarget!.id, {
        label: form.label.trim(),
        category: form.category || null,
        nfcTagId: form.nfcTagId.trim() || null,
        isBillable: form.isBillable,
        minimumDispenseToCapture: form.minimumDispenseToCapture,
        parLevel: parseOptCount(form.parLevel),
        reorderPoint: parseOptCount(form.reorderPoint),
      }),
    onSuccess: () => {
      toast.success(p.itemUpdated);
      qc.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      setFormOpen(false);
    },
    onError: () => toast.error(p.itemUpdateFailed),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.inventoryItems.delete(id),
    onSuccess: () => {
      toast.success(p.itemDeleted);
      qc.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("409") || msg.includes("ITEM_IN_USE")) toast.error(p.itemInUse);
      else toast.error(p.itemDeleteFailed);
    },
  });

  const isPending = editTarget ? updateMut.isPending : createMut.isPending;

  function handleSave() {
    if (editTarget) updateMut.mutate();
    else createMut.mutate();
  }

  return (
    <AppShell>
      <Helmet><title>{p.title} — VetTrack</title></Helmet>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{p.title}</h1>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 me-1" />
              {p.newItem}
            </Button>
          )}
        </div>

        <Input
          placeholder={p.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        {itemsQ.isPending ? (
          <div className="space-y-2" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">{t.common.loading}</span>
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : itemsQ.isError ? (
          <ErrorCard message={p.loadError} onRetry={() => itemsQ.refetch()} />
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">{p.noItems}</p>
        ) : (
          <div className="rounded-lg border overflow-hidden divide-y">
            {grouped.map(([category, items]) => {
              const isExpanded = expandedCategories.has(category);
              return (
                <div key={category}>
                  {/* Category header */}
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-2 px-4 py-2 bg-muted/50 hover:bg-muted/50 text-sm font-medium text-start transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    }
                    <span>{category}</span>
                    <span className="ms-auto text-xs text-muted-foreground font-normal">{items.length}</span>
                  </button>

                  {/* Items within category */}
                  {isExpanded && (
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        {items.map((item) => (
                          <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2 font-mono text-xs text-muted-foreground w-36">{item.code}</td>
                            <td className="px-4 py-2 font-medium">
                              <Link
                                href={`/inventory-items/${item.id}`}
                                className="hover:text-primary hover:underline underline-offset-2 transition-colors"
                              >
                                {item.label}
                              </Link>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                              {item.nfcTagId ?? <span className="opacity-40">—</span>}
                            </td>
                            {isAdmin && (
                              <td className="px-4 py-2 w-20">
                                <div className="flex gap-1 justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn("h-7 px-2")}
                                    onClick={() => openEdit(item)}
                                  >
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
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? p.editItem : p.newItem}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{p.fieldCode}</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                disabled={!!editTarget}
                placeholder={t.inventoryPage.skuPlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label>{p.fieldLabel}</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder={p.fieldLabelPlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label>{p.fieldCategory}</Label>
              <Select
                value={form.category || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.inventoryPage.categoryPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {INVENTORY_ITEM_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{p.fieldNfc}</Label>
              <Input
                value={form.nfcTagId}
                onChange={(e) => setForm((f) => ({ ...f, nfcTagId: e.target.value }))}
                placeholder={p.fieldNfcPlaceholder}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isBillable"
                checked={form.isBillable}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isBillable: !!checked }))}
              />
              <Label htmlFor="isBillable" className="cursor-pointer">{p.fieldIsBillable}</Label>
            </div>
            {form.isBillable && (
              <div className="space-y-1">
                <Label>{p.fieldMinimumDispenseToCapture}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.minimumDispenseToCapture}
                  onChange={(e) => setForm((f) => ({ ...f, minimumDispenseToCapture: Math.max(1, parseInt(e.target.value) || 1) }))}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{p.fieldParLevel}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.parLevel}
                  placeholder={p.optionalPlaceholder}
                  onChange={(e) => setForm((f) => ({ ...f, parLevel: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{p.fieldReorderPoint}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.reorderPoint}
                  placeholder={p.optionalPlaceholder}
                  onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{p.cancel}</Button>
            <Button onClick={handleSave} disabled={isPending || !form.label}>
              {isPending ? p.saving : p.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {p.deleteDescription} <strong>{deleteTarget?.label}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{p.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {p.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
