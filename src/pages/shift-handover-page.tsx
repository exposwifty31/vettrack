// Not using `Layout` navigationLocked; if that is added, wrap tappable regions with [data-restock-allow] (see layout.tsx).
import { t } from "@/lib/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useSearch } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { haptics } from "@/lib/haptics";
import { safeClipboardWriteText } from "@/lib/safe-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ClipboardList, Copy, Loader2, AlertTriangle, ReceiptText, ArrowRightLeft, CheckCircle2, Clock, XCircle, ChevronDown, ChevronUp, Plus, AlertCircle, Users, Bell, History } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimeByLocale } from "@/lib/i18n";
import type { ShiftHandoverSummary, HandoffListItem, HandoffItemDetail, ShiftHandoverPatientsResponse, ShiftHandoverSnapshotRecord, ShiftHandoverSummaryCounts } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { DispenseSheet } from "@/features/containers/components/DispenseSheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

function formatIls(cents: number): string {
  return (cents / 100).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTimeHHMM(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatExpiryYmd(value: string | null): string {
  if (!value?.trim()) return "—";
  const d = new Date(`${value.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("he-IL");
}

function buildHebrewSummary(data: ShiftHandoverSummary): string {
  const p = t.shiftHandoverPage;
  const windowKind = data.windowSource === "open_shift" ? p.windowOpenShift : p.windowFallback;
  const lines: string[] = [
    `*${p.title}*`,
    `${p.windowLabel}: ${formatDateTimeByLocale(new Date(data.windowStart))} — ${formatDateTimeByLocale(new Date(data.windowEnd))}`,
    `${windowKind}`,
    `${p.revenue}: ₪${formatIls(data.revenueCents)}`,
    "",
    `*${p.unreturnedTitle}* (${data.unreturned.length})`,
    ...data.unreturned.map(
      (u) =>
        `• ${u.name}${u.checkedOutByEmail ? ` — ${u.checkedOutByEmail}` : ""}${u.checkedOutLocation ? ` — ${u.checkedOutLocation}` : ""}`,
    ),
    ...(data.unreturned.length === 0 ? [p.noItems] : []),
    "",
    `*${p.activityTitle}* (${data.hotAssets.length})`,
    ...data.hotAssets.map((h) => `• ${h.name} — ${p.scanCount}: ${h.scans}`),
    ...(data.hotAssets.length === 0 ? [p.noItems] : []),
    "",
    `*${p.expiringTitle}* (${data.expiringAssets.length})`,
    ...data.expiringAssets.map(
      (e) => `• ${e.name}${e.expiryDate ? ` — ${p.expiryLabel}: ${formatExpiryYmd(e.expiryDate)}` : ""}`,
    ),
    ...(data.expiringAssets.length === 0 ? [p.noItems] : []),
  ];
  return lines.join("\n");
}

const SECTION_SHELL = {
  unreturned:
    "rounded-xl border border-orange-200/90 bg-orange-50/80 dark:bg-orange-950/25 dark:border-orange-900/50 mb-2 px-1 shadow-sm",
  revenue:
    "rounded-xl border border-emerald-200/90 bg-emerald-50/80 dark:bg-emerald-950/25 dark:border-emerald-900/50 mb-2 px-1 shadow-sm",
  activity:
    "rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 dark:border-primary/25 mb-2 px-1 shadow-sm",
  expiring:
    "rounded-xl border border-amber-200/90 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-900/50 mb-2 px-1 shadow-sm border-b-0",
};

// ─── Handoffs Tab ─────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASSES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  reviewed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const ITEM_STATUS_BADGE_CLASSES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  invalidated: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

function statusLabel(status: string): string {
  const p = t.shiftHandoverPage.patientHandoffs;
  const map: Record<string, string> = {
    draft: p.statusDraft,
    submitted: p.statusSubmitted,
    reviewed: p.statusReviewed,
    cancelled: p.statusCancelled,
  };
  return map[status] ?? status;
}

function itemStatusLabel(status: string): string {
  const p = t.shiftHandoverPage.patientHandoffs;
  const map: Record<string, string> = {
    draft: p.statusItemDraft,
    ready: p.statusItemReady,
    skipped: p.statusItemSkipped,
    invalidated: p.statusItemInvalidated,
  };
  return map[status] ?? status;
}

function HandoffCard({
  handoff,
  isOutgoing,
  userId,
  onCancelled,
  onReviewed,
}: {
  handoff: HandoffListItem;
  isOutgoing: boolean;
  userId: string;
  onCancelled: () => void;
  onReviewed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const p = t.shiftHandoverPage.patientHandoffs;
  const isStale =
    handoff.status === "draft" &&
    Date.now() - new Date(handoff.createdAt).getTime() > 24 * 60 * 60 * 1000;

  const detailQ = useQuery({
    queryKey: ["/api/shift-handover/patient-handoffs", handoff.id],
    queryFn: () => api.shiftHandover.patientHandoffs.get(handoff.id),
    enabled: expanded,
    retry: false,
  });

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await api.shiftHandover.patientHandoffs.cancel(handoff.id, { version: handoff.version });
      toast.success(p.statusCancelled);
      onCancelled();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "CONFLICT_STALE_DRAFT") toast.error(p.staleVersionToast);
      else toast.error(e.message);
    } finally {
      setCancelling(false);
    }
  };

  const handleReview = async () => {
    if (reviewing) return;
    setReviewing(true);
    try {
      await api.shiftHandover.patientHandoffs.review(handoff.id, { version: handoff.version });
      toast.success(p.statusReviewed);
      onReviewed();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "CONFLICT_STALE_DRAFT") toast.error(p.staleVersionToast);
      else toast.error(e.message);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate" dir="auto">
            {isOutgoing ? p.to : p.from}:{" "}
            {isOutgoing ? handoff.receivingUserName : handoff.outgoingUserName}
          </span>
          <Badge className={cn("text-xs px-1.5 py-0 shrink-0", STATUS_BADGE_CLASSES[handoff.status])}>
            {statusLabel(handoff.status)}
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0">
            {handoff.patientCount} {p.patients}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isStale && (
            <AlertCircle className="w-4 h-4 text-amber-500" aria-label={p.staleDraftWarning} />
          )}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {isStale && (
        <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 border-t border-amber-200/60">
          {p.staleDraftWarning}
        </div>
      )}

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">
          {detailQ.isLoading && <Skeleton className="h-20 w-full rounded-lg" />}

          {detailQ.data?.items.map((item) => (
            <HandoffItemRow key={item.id} item={item} submitted={handoff.status !== "draft"} />
          ))}

          <div className="flex justify-end gap-2 pt-1">
            {isOutgoing && handoff.status === "draft" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); void handleCancel(); }}
                disabled={cancelling}
              >
                {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {p.cancelButton}
              </Button>
            )}
            {!isOutgoing && handoff.status === "submitted" && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={(e) => { e.stopPropagation(); void handleReview(); }}
                disabled={reviewing}
              >
                {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {p.markReviewed}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HandoffItemRow({ item, submitted }: { item: HandoffItemDetail; submitted: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-muted/30 text-sm">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium truncate" dir="auto">{item.animalName}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.ward && <span className="text-xs text-muted-foreground">{item.ward}{item.bay ? ` / ${item.bay}` : ""}</span>}
          <Badge className={cn("text-xs px-1.5 py-0", ITEM_STATUS_BADGE_CLASSES[item.status])}>
            {itemStatusLabel(item.status)}
          </Badge>
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </div>
      {open && submitted && (
        <div className="px-3 pb-3 space-y-2 text-sm border-t pt-2">
          {item.currentStability && (
            <p><span className="font-medium">{t.shiftHandoverPage.patientHandoffs.fieldCurrentStability}:</span>{" "}{item.currentStability}</p>
          )}
          {item.pendingTasksNote && (
            <p><span className="font-medium">{t.shiftHandoverPage.patientHandoffs.fieldPendingTasks}:</span>{" "}{item.pendingTasksNote}</p>
          )}
          {item.criticalWarnings && (
            <p className="text-destructive"><span className="font-medium">{t.shiftHandoverPage.patientHandoffs.fieldCriticalWarnings}:</span>{" "}{item.criticalWarnings}</p>
          )}
          {item.clinicalNote && (
            <p><span className="font-medium">{t.shiftHandoverPage.patientHandoffs.fieldClinicalNote}:</span>{" "}{item.clinicalNote}</p>
          )}
          {item.skipReason && (
            <p className="text-muted-foreground italic">{item.skipReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function HandoffsTab({ userId }: { userId: string }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const qc = useQueryClient();
  const p = t.shiftHandoverPage.patientHandoffs;

  const mineQ = useQuery({
    queryKey: ["/api/shift-handover/patient-handoffs/mine"],
    queryFn: () => api.shiftHandover.patientHandoffs.mine(),
    retry: false,
  });

  const invalidate = () => {
    // Two top-level keys are in play: the list query is keyed under
    // ".../patient-handoffs/mine" and per-handoff detail queries are keyed
    // ["/api/shift-handover/patient-handoffs", id]. React Query matches
    // queryKey elements with strict deep equality, not by string-prefix
    // within an element, so we must invalidate both roots.
    qc.invalidateQueries({ queryKey: ["/api/shift-handover/patient-handoffs/mine"] });
    qc.invalidateQueries({ queryKey: ["/api/shift-handover/patient-handoffs"] });
  };

  const outgoing = mineQ.data?.outgoing ?? [];
  const incoming = mineQ.data?.incoming ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{p.outgoingSection}</h2>
        <Button size="sm" className="gap-1.5" onClick={() => setSheetOpen(true)}>
          <Plus className="w-4 h-4" />
          {p.createButton}
        </Button>
      </div>

      {mineQ.isLoading && <Skeleton className="h-16 w-full rounded-xl" />}

      {outgoing.length === 0 && !mineQ.isLoading && (
        <p className="text-sm text-muted-foreground">{p.noOutgoing}</p>
      )}

      {outgoing.map((h) => (
        <HandoffCard
          key={h.id}
          handoff={h}
          isOutgoing
          userId={userId}
          onCancelled={invalidate}
          onReviewed={invalidate}
        />
      ))}

      <div className="mt-4">
        <h2 className="text-base font-semibold mb-3">{p.incomingSection}</h2>

        {incoming.length === 0 && !mineQ.isLoading && (
          <p className="text-sm text-muted-foreground">{p.noIncoming}</p>
        )}

        {incoming.map((h) => (
          <HandoffCard
            key={h.id}
            handoff={h}
            isOutgoing={false}
            userId={userId}
            onCancelled={invalidate}
            onReviewed={invalidate}
          />
        ))}
      </div>

      <CreateHandoffSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={() => {
          invalidate();
          setSheetOpen(false);
        }}
      />
    </div>
  );
}

// ─── CreateHandoffSheet ───────────────────────────────────────────────────────

interface ItemDraft {
  hospitalizationId: string;
  animalName: string;
  ward: string | null;
  bay: string | null;
  // server state
  itemId: string | null;
  itemVersion: number;
  itemStatus: "draft" | "ready" | "skipped" | "invalidated";
  // local edits
  currentStability: string;
  pendingTasksNote: string;
  criticalWarnings: string;
  clinicalNote: string;
  skip: boolean;
  skipReason: string;
  saving: boolean;
  savedOk: boolean;
}

function CreateHandoffSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const p = t.shiftHandoverPage.patientHandoffs;

  // ── Phase 1 state ──
  const [phase, setPhase] = useState<1 | 2>(1);
  const [receivingUserId, setReceivingUserId] = useState("");
  const [selectedHospIds, setSelectedHospIds] = useState<Set<string>>(new Set());
  const [startingDraft, setStartingDraft] = useState(false);

  // ── Phase 2 state ──
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffVersion, setHandoffVersion] = useState(1);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [invalidatedBanner, setInvalidatedBanner] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const staffQ = useQuery({
    queryKey: ["/api/shift-handover/patient-handoffs/eligible-staff"],
    queryFn: () => api.shiftHandover.patientHandoffs.eligibleStaff(),
    enabled: open,
    retry: false,
    refetchOnMount: "always",
  });

  const patientsQ = useQuery({
    queryKey: ["/api/shift-handover/patient-handoffs/eligible-patients"],
    queryFn: () => api.shiftHandover.patientHandoffs.eligiblePatients(),
    enabled: open,
    retry: false,
    refetchOnMount: "always",
  });

  // Reset on close
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setPhase(1);
      setReceivingUserId("");
      setSelectedHospIds(new Set());
      setHandoffId(null);
      setHandoffVersion(1);
      setItems([]);
      setSubmitting(false);
      setSubmitLocked(false);
      setInvalidatedBanner(null);
      setExpandedItem(null);
    }
    onOpenChange(v);
  };

  const toggleHosp = (id: string) => {
    setSelectedHospIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStartDraft = async () => {
    if (!receivingUserId || selectedHospIds.size === 0 || startingDraft) return;
    setStartingDraft(true);
    try {
      const created = await api.shiftHandover.patientHandoffs.create({ receivingUserId });
      setHandoffId(created.id);
      setHandoffVersion(created.version);

      // Create stub items
      const patientMap = new Map(
        (patientsQ.data?.patients ?? []).map((p) => [p.hospitalizationId, p]),
      );

      const initialItems: ItemDraft[] = [];
      for (const hospId of selectedHospIds) {
        const pat = patientMap.get(hospId);
        if (!pat) continue;
        try {
          const res = await api.shiftHandover.patientHandoffs.upsertItem(
            created.id,
            hospId,
            {},
          );
          initialItems.push({
            hospitalizationId: hospId,
            animalName: pat.animalName,
            ward: pat.ward,
            bay: pat.bay,
            itemId: res.id,
            itemVersion: res.version,
            itemStatus: "draft",
            currentStability: "",
            pendingTasksNote: "",
            criticalWarnings: "",
            clinicalNote: "",
            skip: false,
            skipReason: "",
            saving: false,
            savedOk: false,
          });
        } catch {
          // skip failed items silently
        }
      }
      if (initialItems.length === 0) {
        // Every upsertItem failed (network / 4xx). Don't drop the user into
        // phase 2 with an empty draft and a misleadingly-enabled Submit button.
        toast.error(p.startDraftAllItemsFailed);
        try {
          await api.shiftHandover.patientHandoffs.cancel(created.id, { version: created.version });
        } catch {
          // best-effort cleanup; ignore failures
        }
        setHandoffId(null);
        setHandoffVersion(1);
        return;
      }
      setItems(initialItems);
      setExpandedItem(initialItems[0].hospitalizationId);
      setPhase(2);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStartingDraft(false);
    }
  };

  const updateItem = (hospId: string, patch: Partial<ItemDraft>) => {
    setItems((prev) =>
      prev.map((it) => (it.hospitalizationId === hospId ? { ...it, ...patch } : it)),
    );
  };

  const handleSaveItem = async (item: ItemDraft) => {
    if (item.saving || submitLocked || !handoffId) return;
    updateItem(item.hospitalizationId, { saving: true, savedOk: false });
    try {
      const res = await api.shiftHandover.patientHandoffs.upsertItem(
        handoffId,
        item.hospitalizationId,
        {
          version: item.itemVersion,
          status: item.skip ? "skipped" : "ready",
          skipReason: item.skip ? item.skipReason : undefined,
          currentStability: item.skip ? undefined : item.currentStability,
          pendingTasksNote: item.skip ? undefined : item.pendingTasksNote,
          criticalWarnings: item.skip ? undefined : item.criticalWarnings,
          clinicalNote: item.skip ? undefined : item.clinicalNote,
        },
      );
      updateItem(item.hospitalizationId, {
        itemId: res.id,
        itemVersion: res.version,
        itemStatus: res.status as ItemDraft["itemStatus"],
        saving: false,
        savedOk: true,
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      updateItem(item.hospitalizationId, { saving: false });
      if (e.code === "CONFLICT_STALE_DRAFT") {
        toast.error(p.staleVersionToast);
        // Re-fetch detail to get fresh version
        if (handoffId) {
          try {
            const detail = await api.shiftHandover.patientHandoffs.get(handoffId);
            const serverItem = detail.items.find(
              (i) => i.hospitalizationId === item.hospitalizationId,
            );
            if (serverItem) {
              updateItem(item.hospitalizationId, { itemVersion: serverItem.version });
            }
          } catch {}
        }
      } else {
        toast.error(e.message);
      }
    }
  };

  // Recovery action shown on items the server marked "invalidated" during a
  // failed submit. The edit form is hidden for those rows, so without this
  // one-click skip there is no way to satisfy allSaved short of discarding
  // the entire draft.
  const handleSkipInvalidated = async (item: ItemDraft) => {
    if (item.saving || submitLocked || !handoffId) return;
    const skipReason = p.invalidatedSkipReason;
    updateItem(item.hospitalizationId, {
      saving: true,
      savedOk: false,
      skip: true,
      skipReason,
    });
    try {
      const res = await api.shiftHandover.patientHandoffs.upsertItem(
        handoffId,
        item.hospitalizationId,
        { version: item.itemVersion, status: "skipped", skipReason },
      );
      updateItem(item.hospitalizationId, {
        itemId: res.id,
        itemVersion: res.version,
        itemStatus: res.status as ItemDraft["itemStatus"],
        saving: false,
        savedOk: true,
      });
    } catch (err) {
      updateItem(item.hospitalizationId, { saving: false });
      toast.error((err as Error).message);
    }
  };

  const handleSubmit = async () => {
    if (submitting || !handoffId) return;
    setSubmitting(true);
    setSubmitLocked(true);
    setInvalidatedBanner(null);
    try {
      await api.shiftHandover.patientHandoffs.submit(handoffId, { version: handoffVersion });
      toast.success(p.submitSuccess);
      handleOpenChange(false);
      onCreated();
    } catch (err) {
      const e = err as Error & { code?: string; invalidatedItems?: Array<{ id: string; hospitalizationId: string; reason: string }> };
      setSubmitLocked(false);
      if (e.code === "HANDOFF_ITEMS_INVALIDATED" && e.invalidatedItems) {
        const count = e.invalidatedItems.length;
        setInvalidatedBanner(p.invalidatedBanner.replace("{{count}}", String(count)));
        // Mark affected items as invalidated
        for (const inv of e.invalidatedItems) {
          updateItem(inv.hospitalizationId, { itemStatus: "invalidated" });
        }
        // Refetch handoff detail to reconcile item versions
        try {
          const detail = await api.shiftHandover.patientHandoffs.get(handoffId);
          setHandoffVersion(detail.version);
          for (const serverItem of detail.items) {
            updateItem(serverItem.hospitalizationId, { itemVersion: serverItem.version });
          }
        } catch {
          // if refetch fails, use last-known versions; skip will catch stale if it conflicts
        }
      } else if (e.code === "CONFLICT_STALE_DRAFT") {
        toast.error(p.staleVersionToast);
        // Refresh handoff and all item versions
        try {
          const detail = await api.shiftHandover.patientHandoffs.get(handoffId);
          setHandoffVersion(detail.version);
          // Update all item versions to prevent stale conflicts on next attempt
          for (const serverItem of detail.items) {
            updateItem(serverItem.hospitalizationId, { itemVersion: serverItem.version });
          }
        } catch {}
      } else {
        toast.error(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDiscard = async () => {
    if (!handoffId || submitLocked) return;
    try {
      await api.shiftHandover.patientHandoffs.cancel(handoffId, { version: handoffVersion });
      handleOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // items.every(...) returns true on an empty array; guard so the Submit
  // button is never enabled with zero items (server would reject with NO_ITEMS).
  const allSaved =
    items.length > 0 &&
    items.every((it) => it.itemStatus === "ready" || it.itemStatus === "skipped");

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col overflow-hidden">
        <SheetHeader className="shrink-0">
          <SheetTitle>{phase === 1 ? p.setupTitle : p.editTitle}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-4 space-y-4 px-1">
          {/* ── Phase 1: Setup ── */}
          {phase === 1 && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{p.setupReceiverLabel}</label>
                {staffQ.isLoading && <Skeleton className="h-9 w-full rounded-md" />}
                {staffQ.data && (
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={receivingUserId}
                    onChange={(e) => setReceivingUserId(e.target.value)}
                  >
                    <option value="">{p.setupReceiverPlaceholder}</option>
                    {staffQ.data.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName} ({s.role})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{p.setupPatientsLabel}</label>
                {patientsQ.isLoading && <Skeleton className="h-24 w-full rounded-md" />}
                {patientsQ.data?.patients.length === 0 && (
                  <p className="text-sm text-muted-foreground">{p.setupNoPatientsAvailable}</p>
                )}
                {patientsQ.data?.patients.map((pat) => (
                  <label
                    key={pat.hospitalizationId}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={selectedHospIds.has(pat.hospitalizationId)}
                      onChange={() => toggleHosp(pat.hospitalizationId)}
                    />
                    <span className="text-sm font-medium flex-1" dir="auto">
                      {pat.animalName}
                    </span>
                    {(pat.ward || pat.bay) && (
                      <span className="text-xs text-muted-foreground">
                        {[pat.ward, pat.bay].filter(Boolean).join(" / ")}
                      </span>
                    )}
                  </label>
                ))}
              </div>

              <Button
                className="w-full mt-2"
                disabled={!receivingUserId || selectedHospIds.size === 0 || startingDraft}
                onClick={() => void handleStartDraft()}
              >
                {startingDraft ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
                {p.startDraftButton}
              </Button>
            </>
          )}

          {/* ── Phase 2: Per-patient editing ── */}
          {phase === 2 && (
            <>
              {invalidatedBanner && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>{invalidatedBanner}</p>
                </div>
              )}

              {items.map((item) => {
                const isOpen = expandedItem === item.hospitalizationId;
                return (
                  <div key={item.hospitalizationId} className={cn(
                    "rounded-xl border overflow-hidden",
                    item.itemStatus === "invalidated" && "border-red-300 dark:border-red-800",
                    item.itemStatus === "ready" && "border-emerald-300 dark:border-emerald-800",
                    item.itemStatus === "skipped" && "border-amber-300 dark:border-amber-800",
                  )}>
                    <div
                      className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedItem(isOpen ? null : item.hospitalizationId)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate" dir="auto">{item.animalName}</span>
                        {(item.ward || item.bay) && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {[item.ward, item.bay].filter(Boolean).join(" / ")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge className={cn("text-xs px-1.5 py-0", ITEM_STATUS_BADGE_CLASSES[item.itemStatus])}>
                          {itemStatusLabel(item.itemStatus)}
                        </Badge>
                        {item.savedOk && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {isOpen && item.itemStatus !== "invalidated" && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-3">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={item.skip}
                            disabled={submitLocked}
                            onChange={(e) => updateItem(item.hospitalizationId, { skip: e.target.checked })}
                          />
                          {p.skipToggle}
                        </label>

                        {item.skip ? (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">{p.skipReasonLabel}</label>
                            <textarea
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                              rows={2}
                              dir="auto"
                              placeholder={p.skipReasonPlaceholder}
                              value={item.skipReason}
                              disabled={submitLocked}
                              onChange={(e) => updateItem(item.hospitalizationId, { skipReason: e.target.value })}
                            />
                          </div>
                        ) : (
                          <>
                            {([
                              ["currentStability", p.fieldCurrentStability],
                              ["pendingTasksNote", p.fieldPendingTasks],
                              ["criticalWarnings", p.fieldCriticalWarnings],
                              ["clinicalNote", p.fieldClinicalNote],
                            ] as const).map(([field, label]) => (
                              <div key={field} className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                                <textarea
                                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                                  rows={field === "clinicalNote" ? 3 : 2}
                                  dir="auto"
                                  value={item[field]}
                                  disabled={submitLocked}
                                  onChange={(e) => updateItem(item.hospitalizationId, { [field]: e.target.value })}
                                />
                              </div>
                            ))}
                          </>
                        )}

                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          disabled={item.saving || submitLocked || (!item.skip && !item.currentStability)}
                          onClick={() => void handleSaveItem(item)}
                        >
                          {item.saving ? <Loader2 className="w-3 h-3 animate-spin me-1.5" /> : null}
                          {item.saving ? "..." : p.saveItem}
                        </Button>
                      </div>
                    )}

                    {isOpen && item.itemStatus === "invalidated" && (
                      <div className="border-t px-4 py-3 space-y-3">
                        <div className="text-sm text-destructive flex gap-2">
                          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                          {p.statusItemInvalidated}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={item.saving || submitLocked}
                          onClick={() => void handleSkipInvalidated(item)}
                        >
                          {item.saving ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
                          {p.invalidatedSkipButton}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* ── Phase 2 footer ── */}
        {phase === 2 && (
          <div className="shrink-0 pt-4 border-t space-y-2 px-1">
            <Button
              className="w-full"
              disabled={!allSaved || submitting || submitLocked}
              onClick={() => void handleSubmit()}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
              {submitting ? p.submitting : p.submitButton}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={submitLocked}
              onClick={() => void handleDiscard()}
            >
              {p.cancelButton}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function ShiftHandoverPage() {
  const { userId, role, effectiveRole } = useAuth();
  const canBilling = (effectiveRole ?? role) === "admin" || (effectiveRole ?? role) === "vet";
  const search = useSearch();
  const dischargeAnimalId = useMemo(() => new URLSearchParams(search).get("discharge"), [search]);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [completeEmergencyEventId, setCompleteEmergencyEventId] = useState<string | undefined>(undefined);
  const [completeEmergencyContainerId, setCompleteEmergencyContainerId] = useState<string | undefined>(undefined);

  const dischargeQ = useQuery({
    queryKey: ["/api/shift-handover/discharge", dischargeAnimalId ?? ""],
    queryFn: () => api.shiftHandover.getDischargeItems(dischargeAnimalId!),
    enabled: Boolean(dischargeAnimalId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (dischargeAnimalId) setDischargeOpen(true);
  }, [dischargeAnimalId]);

  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["/api/shift-handover/summary"],
    queryFn: () => api.shiftHandover.getSummary(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const consumablesQ = useQuery({
    queryKey: ["/api/shift-handover/consumables-report", q.data?.windowStart, q.data?.windowEnd],
    queryFn: () =>
      api.shiftHandover.consumablesReport(
        q.data!.windowStart,
        q.data!.windowEnd,
      ),
    enabled: !!q.data?.windowStart,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const handoffsMineQ = useQuery({
    queryKey: ["/api/shift-handover/patient-handoffs/mine"],
    queryFn: () => api.shiftHandover.patientHandoffs.mine(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const pendingIncomingCount = (handoffsMineQ.data?.incoming ?? []).filter(
    (h) => h.status === "submitted",
  ).length;

  const patientsQ = useQuery({
    queryKey: ["/api/shift-handover/patients"],
    queryFn: () => api.shiftHandover.getPatients(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const snapshotQ = useQuery({
    queryKey: ["/api/shift-handover/snapshot/latest"],
    queryFn: () => api.shiftHandover.getLatestSnapshot(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const startMut = useMutation({
    mutationFn: () => api.shiftHandover.startSession(),
    onSuccess: () => {
      toast.success(t.shiftHandoverPage.startShift);
      qc.invalidateQueries({ queryKey: ["/api/shift-handover/summary"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        toast.error(t.shiftHandoverPage.shiftConflict);
      } else {
        toast.error(t.shiftHandoverPage.loadError);
      }
    },
  });

  const endMut = useMutation({
    mutationFn: () => api.shiftHandover.endSession(),
    onSuccess: () => {
      toast.success(t.shiftHandoverPage.endShift);
      qc.invalidateQueries({ queryKey: ["/api/shift-handover/summary"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("NO_OPEN_SHIFT") || msg.includes("No open shift")) {
        toast.error(t.shiftHandoverPage.noOpenShift);
      } else {
        toast.error(t.shiftHandoverPage.loadError);
      }
    },
  });

  const copySummary = async () => {
    if (!q.data) return;
    const copied = await safeClipboardWriteText(buildHebrewSummary(q.data));
    if (copied) {
      haptics.scanSuccess();
      toast.success(t.shiftHandoverPage.copied);
    } else {
      toast.error(t.shiftHandoverPage.loadError);
    }
  };

  const p = t.shiftHandoverPage;
  const data = q.data;

  return (
    <Layout title={p.title}>
      <Helmet>
        <title>{p.title} — VetTrack</title>
      </Helmet>
      <Dialog open={dischargeOpen} onOpenChange={setDischargeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.shiftHandoverPage.dischargeTitle}</DialogTitle>
          </DialogHeader>
          {dischargeQ.isLoading && <Skeleton className="h-20 w-full" />}
          {dischargeQ.data && (
            <ul className="text-sm space-y-2">
              {dischargeQ.data.items.length === 0 ? (
                <li className="text-muted-foreground">{t.shiftHandoverPage.dischargeEmpty}</li>
              ) : (
                dischargeQ.data.items.map((it) => (
                  <li key={it.sessionId} className="font-medium">
                    {it.equipmentName ?? "—"}
                  </li>
                ))
              )}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDischargeOpen(false)}>
              {t.shiftHandoverPage.dischargeClose}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
              <ClipboardList className="w-7 h-7 text-primary shrink-0" aria-hidden />
              {p.title}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{p.subtitle}</p>
            {canBilling && (
              <Link
                href="/billing"
                className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline min-h-[44px] sm:min-h-0"
              >
                <ReceiptText className="w-3.5 h-3.5 shrink-0" aria-hidden />
                {p.viewBillingLedger}
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="default"
              className="gap-2 min-h-[44px] rounded-xl font-semibold shadow-sm"
              onClick={() => copySummary()}
              disabled={!data || q.isLoading}
            >
              <Copy className="w-4 h-4 shrink-0" />
              {p.copySummary}
            </Button>
            {!data?.openShiftSession ? (
              <Button variant="outline" size="default" className="min-h-[44px] rounded-xl" onClick={() => startMut.mutate()} disabled={startMut.isPending}>
                {startMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {p.startShift}
              </Button>
            ) : (
              <Button variant="secondary" size="default" className="min-h-[44px] rounded-xl" onClick={() => endMut.mutate()} disabled={endMut.isPending}>
                {endMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {p.endShift}
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="mb-4 w-full justify-start">
            <TabsTrigger value="summary" className="flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" aria-hidden />
              {p.title}
            </TabsTrigger>
            <TabsTrigger value="handoffs" className="flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4" aria-hidden />
              {p.patientHandoffs.tabLabel}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
        {pendingIncomingCount > 0 && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 flex items-center gap-2">
            <Clock className="w-4 h-4 shrink-0" aria-hidden />
            {p.patientHandoffs.shiftSummaryPendingIncoming.replace("{{count}}", String(pendingIncomingCount))}
          </div>
        )}
        {q.isLoading && (
          <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">{t.common.loading}</span>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        )}

        {q.isError && (
          <Card className="border-destructive/50 rounded-xl">
            <CardContent className="pt-6 text-destructive">{p.loadError}</CardContent>
          </Card>
        )}

        {data && (
          <Accordion
            type="multiple"
            defaultValue={["unreturned", "revenue", "activity", "expiring"]}
            className="w-full space-y-2"
          >
            <AccordionItem value="unreturned" className={cn("border-0", SECTION_SHELL.unreturned)}>
              <AccordionTrigger className="text-base font-semibold px-3 hover:no-underline text-orange-950 dark:text-orange-100">
                {p.unreturnedTitle}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                {data.unreturned.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{p.noItems}</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1 text-sm leading-relaxed">
                    {data.unreturned.map((u) => (
                      <li key={u.id}>
                        <span className="font-medium">{u.name}</span>
                        {u.checkedOutByEmail ? ` — ${u.checkedOutByEmail}` : ""}
                        {u.checkedOutLocation ? ` — ${u.checkedOutLocation}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="revenue" className={cn("border-0", SECTION_SHELL.revenue)}>
              <AccordionTrigger className="text-base font-semibold px-3 hover:no-underline text-emerald-950 dark:text-emerald-100">
                {p.revenueSectionTitle}
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2 px-3 pb-3">
                <p>
                  {formatDateTimeByLocale(new Date(data.windowStart))} — {formatDateTimeByLocale(new Date(data.windowEnd))}
                </p>
                <p className="text-muted-foreground">
                  {data.windowSource === "open_shift" ? p.windowOpenShift : p.windowFallback}
                </p>
                <p className="text-xl font-bold pt-1 text-emerald-900 dark:text-emerald-200 tabular-nums">
                  {p.revenue}: ₪{formatIls(data.revenueCents)}
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="activity" className={cn("border-0", SECTION_SHELL.activity)}>
              <AccordionTrigger className="text-base font-semibold px-3 hover:no-underline text-foreground">
                {p.activityTitle}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                {data.hotAssets.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{p.noItems}</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {data.hotAssets.map((h) => (
                      <li key={h.id}>
                        {h.name} — {p.scanCount}: {h.scans}
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="expiring" className={cn("border-0", SECTION_SHELL.expiring)}>
              <AccordionTrigger className="text-base font-semibold px-3 hover:no-underline text-amber-950 dark:text-amber-100">
                {p.expiringTitle}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                {data.expiringAssets.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{p.noItems}</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {data.expiringAssets.map((e) => (
                      <li key={e.id}>
                        <span className="font-medium">{e.name}</span>
                        {e.expiryDate ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {p.expiryLabel}: {formatExpiryYmd(e.expiryDate)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {/* ── Consumables Report Section ── */}
        {consumablesQ.data && (
          <div className="mt-4 space-y-3" dir="rtl">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" aria-hidden />
              {p.consumablesTitle}
            </h2>

            {consumablesQ.data.pendingEmergencies > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-red-400 bg-red-50 dark:bg-red-950/25 p-3">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
                <p className="text-sm font-bold text-red-800 dark:text-red-300 flex-1">
                  {p.pendingEmergenciesAlert(consumablesQ.data.pendingEmergencies)}
                </p>
                <Link
                  href="/pending-emergencies"
                  className="shrink-0 text-sm font-bold text-red-700 dark:text-red-300 underline underline-offset-2 hover:text-red-900 dark:hover:text-red-100 whitespace-nowrap"
                >
                  {p.resolveItems(consumablesQ.data.pendingEmergencies)}
                </Link>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-xl border p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{consumablesQ.data.totalEvents}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.totalEvents}</p>
              </div>
              <div className={cn("rounded-xl border p-3 text-center", consumablesQ.data.unlinkedCount > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950/25" : "")}>
                <p className="text-2xl font-bold tabular-nums">{consumablesQ.data.unlinkedCount}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.unlinkedCount}</p>
              </div>
              <div className={cn("rounded-xl border p-3 text-center", consumablesQ.data.unlinkedPct > 20 ? "border-red-300 bg-red-50 dark:bg-red-950/25" : "")}>
                <p className="text-2xl font-bold tabular-nums">{consumablesQ.data.unlinkedPct}%</p>
                <p className="text-xs text-muted-foreground mt-1">{p.unlinkedPct}</p>
              </div>
              <div className={cn("rounded-xl border p-3 text-center relative", consumablesQ.data.pendingEmergencies > 0 ? "border-red-400 bg-red-50 dark:bg-red-950/25" : "")}>
                <p className="text-2xl font-bold tabular-nums">{consumablesQ.data.pendingEmergencies}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.pendingEmergencyCard}</p>
                {consumablesQ.data.pendingEmergencies > 0 && (
                  <span className="absolute top-1 left-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
              <div className={cn("rounded-xl border p-3 text-center relative", consumablesQ.data.unBilledCount > 0 ? "border-red-500 bg-red-50 dark:bg-red-950/25" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20")}>
                <p className={cn("text-2xl font-bold tabular-nums", consumablesQ.data.unBilledCount > 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}>
                  {consumablesQ.data.unBilledCount}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{p.unbilledCount}</p>
                {consumablesQ.data.unBilledCount > 0 && (
                  <span className="absolute top-1 left-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
            </div>

            {/* Staff Activity */}
            {consumablesQ.data.userActivity.length > 0 && (
              <div className="overflow-x-auto rounded-xl border">
                <h3 className="text-sm font-semibold px-3 py-2 border-b bg-muted/50">{p.staffActivity}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-right font-medium">{p.colName}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colEvents}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colBilled}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colCaptureRate}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumablesQ.data.userActivity.map((ua) => {
                      const isMissing = ua.dispensedCount > 0 && ua.billedCount === 0;
                      const isLow = !isMissing && ua.captureRatePercent < 50;
                      return (
                        <tr
                          key={ua.userId}
                          className={cn(
                            "border-b last:border-0",
                            isMissing ? "bg-red-50/70 dark:bg-red-950/20" : isLow ? "bg-amber-50/70 dark:bg-amber-950/20" : "",
                          )}
                        >
                          <td className="px-3 py-2 font-medium">{ua.userName}</td>
                          <td className="px-3 py-2 tabular-nums">{ua.dispensedCount}</td>
                          <td className="px-3 py-2 tabular-nums">{ua.billedCount}</td>
                          <td className={cn(
                            "px-3 py-2 tabular-nums font-semibold",
                            isMissing ? "text-red-700 dark:text-red-400" : isLow ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400",
                          )}>
                            {ua.captureRatePercent}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Events table */}
            {consumablesQ.data.events.length > 0 && (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-right font-medium">{p.colWhen}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colTakenBy}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colItem}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colQuantity}</th>
                      <th className="px-3 py-2 text-right font-medium">{p.colPatient}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumablesQ.data.events.map((ev) => (
                      <tr
                        key={ev.id}
                        className={cn(
                          "border-b last:border-0",
                          ev.pendingCompletion ? "border-r-4 border-r-red-500" : "",
                        )}
                      >
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {formatTimeHHMM(ev.takenAt)}
                        </td>
                        <td className="px-3 py-2 font-medium" dir="auto">{ev.takenByDisplayName}</td>
                        <td className="px-3 py-2 break-words max-w-[120px]" dir="auto">{ev.itemLabel}</td>
                        <td className="px-3 py-2 tabular-nums">{ev.quantity}</td>
                        <td className="px-3 py-2">
                          {ev.pendingCompletion ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800 font-medium">
                                {p.emergencyPendingBadge}
                              </span>
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 px-3 text-xs font-bold bg-red-600 hover:bg-red-700 text-white min-h-[44px]"
                                onClick={() => {
                                  setCompleteEmergencyEventId(ev.id);
                                  setCompleteEmergencyContainerId(ev.containerId);
                                }}
                              >
                                {p.completeNow}
                              </Button>
                            </div>
                          ) : ev.animalName ? (
                            <span className="text-foreground">{ev.animalName}</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                              {p.unlinkedBadge}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {consumablesQ.data.events.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{p.noConsumablesInShift}</p>
            )}
          </div>
        )}

        {consumablesQ.isLoading && q.data && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-48 rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}

        {/* ── Patient Continuity Section ── */}
        <PatientContinuitySection patientsQ={patientsQ} p={p} />

        {/* ── Previous Snapshot Section ── */}
        <PreviousSnapshotSection snapshotQ={snapshotQ} p={p} />
          </TabsContent>

          <TabsContent value="handoffs">
            <HandoffsTab userId={userId ?? ""} />
          </TabsContent>
        </Tabs>

        {/* DispenseSheet for completing emergency events from shift report */}
        {completeEmergencyEventId && completeEmergencyContainerId && (
          <DispenseSheet
            containerId={completeEmergencyContainerId}
            isOpen={Boolean(completeEmergencyEventId)}
            onClose={() => {
              setCompleteEmergencyEventId(undefined);
              setCompleteEmergencyContainerId(undefined);
            }}
            emergencyEventId={completeEmergencyEventId}
          />
        )}
      </div>
    </Layout>
  );
}

// ─── Patient Continuity Sub-component ────────────────────────────────────────

function safeSummaryCounts(raw: unknown): ShiftHandoverSummaryCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.patientCount !== "number" ||
    typeof r.pendingTaskCount !== "number" ||
    typeof r.overdueCount !== "number" ||
    typeof r.unresolvedEmergencyCount !== "number"
  ) return null;
  return r as unknown as ShiftHandoverSummaryCounts;
}

type PatientsQueryResult = ReturnType<typeof useQuery<ShiftHandoverPatientsResponse>>;
type SnapshotQueryResult = ReturnType<typeof useQuery<ShiftHandoverSnapshotRecord>>;

function PatientContinuitySection({
  patientsQ,
  p,
}: {
  patientsQ: PatientsQueryResult;
  p: typeof t.shiftHandoverPage;
}) {
  const data = patientsQ.data;
  const counts = data?.summaryCounts;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Users className="w-5 h-5 text-primary shrink-0" aria-hidden />
          {p.patientContinuityTitle}
        </h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
          {p.patientContinuityLiveBadge}
        </span>
      </div>
      <p className="text-sm text-muted-foreground -mt-1">{p.patientContinuitySubtitle}</p>

      {patientsQ.isLoading && (
        <div className="space-y-2" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">{t.common.loading}</span>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {patientsQ.isError && (
        <Card className="border-destructive/50 rounded-xl">
          <CardContent className="pt-4 pb-3 text-destructive text-sm">{p.patientContinuityError}</CardContent>
        </Card>
      )}

      {!patientsQ.isError && data && (
        <>
          {/* Summary counts */}
          {counts && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border p-3 text-center">
                <p className="text-xl font-bold tabular-nums">{counts.patientCount}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.patientCountLabel}</p>
              </div>
              <div className={cn("rounded-xl border p-3 text-center", counts.pendingTaskCount > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950/25" : "")}>
                <p className="text-xl font-bold tabular-nums">{counts.pendingTaskCount}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.pendingTaskCountLabel}</p>
              </div>
              <div className={cn("rounded-xl border p-3 text-center", counts.overdueCount > 0 ? "border-red-300 bg-red-50 dark:bg-red-950/25" : "")}>
                <p className={cn("text-xl font-bold tabular-nums", counts.overdueCount > 0 ? "text-red-700 dark:text-red-300" : "")}>{counts.overdueCount}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.overdueCountLabel}</p>
              </div>
              <div className={cn("rounded-xl border p-3 text-center relative", counts.unresolvedEmergencyCount > 0 ? "border-red-400 bg-red-50 dark:bg-red-950/25" : "")}>
                <p className={cn("text-xl font-bold tabular-nums", counts.unresolvedEmergencyCount > 0 ? "text-red-700 dark:text-red-300" : "")}>{counts.unresolvedEmergencyCount}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.emergencyCountLabel}</p>
                {counts.unresolvedEmergencyCount > 0 && (
                  <span className="absolute top-1 left-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* Active alerts (clinic-wide) */}
          {data.activeAlerts.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 dark:bg-amber-950/20 p-3 space-y-1">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
                {p.activeAlertsTitle}
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-sm text-amber-900 dark:text-amber-200">
                {data.activeAlerts.map((alert, i) => (
                  <li key={i} dir="auto">{alert.alertType}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Patient list */}
          {data.patients.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{p.patientContinuityEmpty}</p>
          ) : (
            <Accordion type="multiple" className="w-full space-y-2">
              {data.patients.map((patient) => {
                const hasOverdue = patient.overdueMedicationCount > 0;
                const hasEmergency = patient.unresolvedEmergencyDispenses.length > 0;
                const hasTasks = patient.pendingMedicationTasks.length > 0;
                return (
                  <AccordionItem
                    key={patient.hospitalizationId}
                    value={patient.hospitalizationId}
                    className={cn(
                      "border-0 rounded-xl px-1 shadow-sm",
                      hasOverdue || hasEmergency
                        ? "border border-red-200/90 bg-red-50/60 dark:bg-red-950/15 dark:border-red-900/40"
                        : hasTasks
                          ? "border border-amber-200/90 bg-amber-50/60 dark:bg-amber-950/15 dark:border-amber-900/40"
                          : "border border-border bg-muted/30",
                    )}
                  >
                    <AccordionTrigger className="px-3 py-3 hover:no-underline min-h-[44px]">
                      <div className="flex flex-wrap items-center gap-2 w-full text-start">
                        <span className="font-semibold text-sm" dir="auto">{patient.animalName}</span>
                        {patient.ward && (
                          <span className="text-xs text-muted-foreground" dir="auto">
                            {p.wardLabel}: {patient.ward}
                            {patient.bay ? ` / ${p.bayLabel}: ${patient.bay}` : ""}
                          </span>
                        )}
                        <div className="flex gap-1.5 flex-wrap ms-auto">
                          {hasTasks && (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                              hasOverdue
                                ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
                            )}>
                              <Clock className="w-3 h-3 shrink-0" aria-hidden />
                              {patient.pendingMedicationTasks.length}
                              {hasOverdue ? ` (${patient.overdueMedicationCount} ${p.overdueLabel})` : ` ${p.pendingTasksLabel}`}
                            </span>
                          )}
                          {hasEmergency && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
                              {patient.unresolvedEmergencyDispenses.length} {p.emergencyDispensesLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 space-y-2 text-sm">
                      {patient.pendingMedicationTasks.length > 0 ? (
                        <div>
                          <p className="font-medium text-xs text-muted-foreground mb-1">{p.pendingTasksLabel}</p>
                          <ul className="space-y-1">
                            {patient.pendingMedicationTasks.map((task) => {
                              const isOverdue = task.dueAt ? new Date(task.dueAt) < new Date() : false;
                              return (
                                <li key={task.id} className={cn("flex items-center gap-2 text-xs rounded px-2 py-1", isOverdue ? "bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200" : "bg-muted/50 text-foreground")}>
                                  <span className="font-mono" dir="auto">{task.drugId}</span>
                                  <span className="text-muted-foreground">{task.status}</span>
                                  {task.dueAt && (
                                    <span className="ms-auto tabular-nums text-muted-foreground">{formatDateTimeByLocale(new Date(task.dueAt))}</span>
                                  )}
                                  {isOverdue && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" aria-hidden />}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{p.noItems}</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </>
      )}
    </div>
  );
}

// ─── Previous Snapshot Sub-component ─────────────────────────────────────────

function PreviousSnapshotSection({
  snapshotQ,
  p,
}: {
  snapshotQ: SnapshotQueryResult;
  p: typeof t.shiftHandoverPage;
}) {
  const snap = snapshotQ.data;
  const is404 = snapshotQ.isError && snapshotQ.error instanceof Error && (snapshotQ.error.message.includes("NO_SNAPSHOT") || snapshotQ.error.message.includes("No handover snapshot"));

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <History className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
          {p.previousSnapshotTitle}
        </h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
          {p.previousSnapshotHistoricalBadge}
        </span>
      </div>

      {snapshotQ.isLoading && (
        <div className="space-y-2" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">{t.common.loading}</span>
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {snapshotQ.isError && !is404 && (
        <Card className="border-destructive/50 rounded-xl">
          <CardContent className="pt-4 pb-3 text-destructive text-sm">{p.previousSnapshotError}</CardContent>
        </Card>
      )}

      {(is404 || (!snapshotQ.isLoading && !snapshotQ.isError && !snap)) && (
        <p className="text-sm text-muted-foreground py-2">{p.previousSnapshotEmpty}</p>
      )}

      {!snapshotQ.isError && snap && (
        <Card className="rounded-xl border border-border bg-muted/20">
          <CardContent className="pt-4 pb-4 space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" aria-hidden />
              {p.snapshotGeneratedAt}: {formatDateTimeByLocale(new Date(snap.generatedAt))}
            </p>
            <SnapshotSummaryCounts raw={snap.summaryCounts} p={p} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SnapshotSummaryCounts({
  raw,
  p,
}: {
  raw: unknown;
  p: typeof t.shiftHandoverPage;
}) {
  const counts = safeSummaryCounts(raw);
  if (!counts) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2">{p.summaryCountsTitle}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border p-2 text-center">
          <p className="text-lg font-bold tabular-nums">{counts.patientCount}</p>
          <p className="text-xs text-muted-foreground">{p.patientCountLabel}</p>
        </div>
        <div className={cn("rounded-lg border p-2 text-center", counts.pendingTaskCount > 0 ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : "")}>
          <p className="text-lg font-bold tabular-nums">{counts.pendingTaskCount}</p>
          <p className="text-xs text-muted-foreground">{p.pendingTaskCountLabel}</p>
        </div>
        <div className={cn("rounded-lg border p-2 text-center", counts.overdueCount > 0 ? "border-red-300 bg-red-50/60 dark:bg-red-950/20" : "")}>
          <p className={cn("text-lg font-bold tabular-nums", counts.overdueCount > 0 ? "text-red-700 dark:text-red-300" : "")}>{counts.overdueCount}</p>
          <p className="text-xs text-muted-foreground">{p.overdueCountLabel}</p>
        </div>
        <div className={cn("rounded-lg border p-2 text-center", counts.unresolvedEmergencyCount > 0 ? "border-red-400 bg-red-50/60 dark:bg-red-950/20" : "")}>
          <p className={cn("text-lg font-bold tabular-nums", counts.unresolvedEmergencyCount > 0 ? "text-red-700 dark:text-red-300" : "")}>{counts.unresolvedEmergencyCount}</p>
          <p className="text-xs text-muted-foreground">{p.emergencyCountLabel}</p>
        </div>
      </div>
    </div>
  );
}
