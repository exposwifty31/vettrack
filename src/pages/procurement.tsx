import { t } from "@/lib/i18n";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus, InventoryItem } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { ShoppingCart, Plus, ChevronDown, ChevronUp, Trash2, Send, PackageCheck, X } from "lucide-react";

const STATUS_BADGE: Record<PurchaseOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  ordered: "bg-primary/10 text-primary border-border",
  partial: "bg-muted/80 text-foreground border-amber-500/20",
  received: "bg-status-ok/10 text-status-ok border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

type ReceiveLine = { lineId: string; quantityReceived: number; containerId: string };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function poTotalCents(lines: PurchaseOrderLine[] | undefined): number {
  return (lines ?? []).reduce((sum, l) => sum + l.unitPriceCents * l.quantityOrdered, 0);
}

export default function ProcurementPage() {
  const qc = useQueryClient();
  const p = t.procurementPage;
  const { userId, role, isLoaded } = useAuth();
  const isAdmin = role === "admin";

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);

  // Create PO form state
  const [supplierName, setSupplierName] = useState("");
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<{ itemId: string; quantityOrdered: number; unitPriceCents: number }[]>([
    { itemId: "", quantityOrdered: 1, unitPriceCents: 0 },
  ]);

  // Receive form state
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);

  const ordersQ = useQuery({
    queryKey: ["/api/procurement", statusFilter],
    queryFn: () => api.procurement.list(statusFilter !== "all" ? { status: statusFilter } : undefined),
    enabled: !!userId && isLoaded,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const itemsQ = useQuery({
    queryKey: ["/api/inventory-items"],
    queryFn: () => api.inventoryItems.list(),
    enabled: !!userId && createOpen,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const containersQ = useQuery({
    queryKey: ["/api/containers"],
    queryFn: () => api.containers.list(),
    enabled: !!userId && !!receiveTarget,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const itemById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of itemsQ.data ?? []) map.set(item.id, item);
    return map;
  }, [itemsQ.data]);

  const createMut = useMutation({
    mutationFn: () =>
      api.procurement.create({
        supplierName: supplierName.trim(),
        lines: draftLines.filter((l) => l.itemId),
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(p.poCreated);
      qc.invalidateQueries({ queryKey: ["/api/procurement"] });
      setCreateOpen(false);
      setSupplierName("");
      setNotes("");
      setDraftLines([{ itemId: "", quantityOrdered: 1, unitPriceCents: 0 }]);
    },
    onError: () => toast.error(p.poCreateFailed),
  });

  const submitMut = useMutation({
    mutationFn: (id: string) => api.procurement.submit(id),
    onSuccess: () => {
      toast.success(p.poSubmitted);
      qc.invalidateQueries({ queryKey: ["/api/procurement"] });
    },
    onError: () => toast.error(p.poSubmitFailed),
  });

  const receiveMut = useMutation({
    mutationFn: ({ id, lines }: { id: string; lines: ReceiveLine[] }) =>
      api.procurement.receive(id, { lines }),
    onSuccess: () => {
      toast.success(p.poReceived);
      qc.invalidateQueries({ queryKey: ["/api/procurement"] });
      qc.invalidateQueries({ queryKey: ["/api/containers"] });
      qc.invalidateQueries({ queryKey: ["/api/restock/container-items"] });
      setReceiveTarget(null);
    },
    onError: () => toast.error(p.poReceiveFailed),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.procurement.cancel(id),
    onSuccess: () => {
      toast.success(p.poCancelled);
      qc.invalidateQueries({ queryKey: ["/api/procurement"] });
      setCancelTarget(null);
    },
    onError: () => toast.error(p.poCancelFailed),
  });

  function openReceive(order: PurchaseOrder) {
    setReceiveTarget(order);
    setReceiveLines(
      (order.lines ?? []).map((l: PurchaseOrderLine) => ({
        lineId: l.id,
        quantityReceived: Math.max(0, l.quantityOrdered - l.quantityReceived),
        containerId: "",
      })),
    );
  }

  const orders = ordersQ.data ?? [];

  const pageContent = (
    <>
      <Helmet><title>{p.title} — VetTrack</title></Helmet>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{p.title}</h1>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 me-1" />
              {p.newPo}
            </Button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap gap-2">
          {(["all", "draft", "ordered", "partial", "received", "cancelled"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {p[`status_${s}` as keyof typeof p] ?? s}
            </button>
          ))}
        </div>

        {(ordersQ.isPending || (ordersQ.isError && ordersQ.isFetching)) ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : ordersQ.isError ? (
          <ErrorCard message={p.loadError} onRetry={() => ordersQ.refetch()} />
        ) : orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">{p.noOrders}</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => {
              const total = poTotalCents(order.lines);
              return (
                <div key={order.id} className="rounded-lg border bg-card">
                  <div
                    className="flex flex-wrap items-start gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  >
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium truncate">{order.supplierName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap leading-relaxed">
                        <span>{formatDate(order.orderedAt ?? order.createdAt)}</span>
                        <span>·</span>
                        <span>{(order.lines ?? []).length} {p.lineCount}</span>
                        {total > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-foreground">
                              ${(total / 100).toFixed(2)}
                            </span>
                          </>
                        )}
                        {order.expectedAt && (
                          <>
                            <span>·</span>
                            <span>Expected {formatDate(order.expectedAt)}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${STATUS_BADGE[order.status]}`}>
                      {p[`status_${order.status}` as keyof typeof p] ?? order.status}
                    </span>
                    <div className="flex flex-wrap gap-1 ms-auto">
                      {isAdmin && order.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => { e.stopPropagation(); submitMut.mutate(order.id); }}
                          disabled={submitMut.isPending}
                        >
                          <Send className="h-3 w-3 me-1" />
                          {p.submit}
                        </Button>
                      )}
                      {(order.status === "ordered" || order.status === "partial") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => { e.stopPropagation(); openReceive(order); }}
                        >
                          <PackageCheck className="h-3 w-3 me-1" />
                          {p.receive}
                        </Button>
                      )}
                      {isAdmin && order.status !== "received" && order.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setCancelTarget(order); }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="shrink-0 self-center">
                      {expandedId === order.id
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                    </div>
                  </div>

                  {expandedId === order.id && (order.lines ?? []).length > 0 && (
                    <div className="border-t px-4 pb-3">
                      <table className="w-full text-xs mt-2">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-start py-1 font-medium">{p.lineItem}</th>
                            <th className="text-right py-1 font-medium">{p.lineOrdered}</th>
                            <th className="text-right py-1 font-medium">{p.lineReceived}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {(order.lines ?? []).map((line: PurchaseOrderLine) => (
                            <tr key={line.id}>
                              <td className="py-1">{line.itemLabel ?? line.itemId}</td>
                              <td className="py-1 text-end">{line.quantityOrdered}</td>
                              <td className={`py-1 text-end ${line.quantityReceived >= line.quantityOrdered ? "text-emerald-600 font-medium" : ""}`}>
                                {line.quantityReceived}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {order.notes && <p className="text-xs text-muted-foreground mt-2 italic">{order.notes}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create PO dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg w-full max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{p.newPo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{p.fieldSupplier}</Label>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder={p.fieldSupplierPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{p.fieldLines}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setDraftLines((l) => [...l, { itemId: "", quantityOrdered: 1, unitPriceCents: 0 }])}
                >
                  <Plus className="h-3 w-3 me-1" />
                  {p.addLine}
                </Button>
              </div>
              {draftLines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Select
                    value={line.itemId}
                    onValueChange={(v) =>
                      setDraftLines((ls) => ls.map((l, i) => i === idx ? { ...l, itemId: v } : l))
                    }
                    disabled={itemsQ.isLoading}
                  >
                    <SelectTrigger className="flex-1 h-8 text-xs">
                      <SelectValue placeholder={itemsQ.isLoading ? p.loadingItems : p.selectItem} />
                    </SelectTrigger>
                    <SelectContent>
                      {itemsQ.isLoading ? (
                        <SelectItem value="__loading__" disabled>{p.loadingItems}</SelectItem>
                      ) : (itemsQ.data ?? []).length === 0 ? (
                        <SelectItem value="__empty__" disabled>{p.noItemsAvailable}</SelectItem>
                      ) : (
                        (itemsQ.data ?? []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    className="w-16 h-8 text-xs"
                    value={line.quantityOrdered}
                    onChange={(e) =>
                      setDraftLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantityOrdered: Number(e.target.value) } : l))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-destructive hover:text-destructive"
                    onClick={() => setDraftLines((ls) => ls.filter((_, i) => i !== idx))}
                    disabled={draftLines.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <Label>{p.fieldNotes}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={p.fieldNotesPlaceholder}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{p.cancel}</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !supplierName || draftLines.every((l) => !l.itemId)}
            >
              {createMut.isPending ? p.saving : p.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive dialog */}
      <Dialog open={!!receiveTarget} onOpenChange={(o) => !o && setReceiveTarget(null)}>
        <DialogContent className="max-w-lg w-full max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{p.receiveTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {receiveLines.map((rl, idx) => {
              const line = (receiveTarget?.lines ?? []).find((l: PurchaseOrderLine) => l.id === rl.lineId);
              if (!line) return null;
              return (
                <div key={rl.lineId} className="space-y-1 border rounded-lg p-3">
                  <p className="text-sm font-medium">{line.itemLabel ?? line.itemId}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.ordered}: {line.quantityOrdered} · {p.alreadyReceived}: {line.quantityReceived}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{p.qtyReceiving}</Label>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 text-sm"
                        value={rl.quantityReceived}
                        onChange={(e) =>
                          setReceiveLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantityReceived: Number(e.target.value) } : l))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{p.containerLabel}</Label>
                      <Select
                        value={rl.containerId || "__none__"}
                        onValueChange={(v) =>
                          setReceiveLines((ls) => ls.map((l, i) => i === idx ? { ...l, containerId: v === "__none__" ? "" : v } : l))
                        }
                        disabled={containersQ.isLoading}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder={containersQ.isLoading ? p.loadingContainers : p.selectContainer} />
                        </SelectTrigger>
                        <SelectContent>
                          {containersQ.isLoading ? (
                            <SelectItem value="__loading__" disabled>{p.loadingContainers}</SelectItem>
                          ) : (
                            <>
                              <SelectItem value="__none__">{p.selectNone}</SelectItem>
                              {(containersQ.data ?? []).map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>{p.cancel}</Button>
            <Button
              onClick={() =>
                receiveTarget &&
                receiveMut.mutate({
                  id: receiveTarget.id,
                  lines: receiveLines.filter((l) => l.quantityReceived > 0 && l.containerId),
                })
              }
              disabled={receiveMut.isPending || receiveLines.every((l) => l.quantityReceived === 0 || !l.containerId)}
            >
              {receiveMut.isPending ? p.saving : p.receiveConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.cancelTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {p.cancelDescription} <strong>{cancelTarget?.supplierName}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{p.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTarget && cancelMut.mutate(cancelTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {p.cancelConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
