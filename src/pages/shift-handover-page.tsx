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
import { ClipboardList, Copy, Loader2, AlertTriangle, ReceiptText, Users, Bell, Clock, History } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimeByLocale } from "@/lib/i18n";
import type { ShiftHandoverSummary, ShiftHandoverPatientsResponse, ShiftHandoverSnapshotRecord, ShiftHandoverSummaryCounts } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { DispenseSheet } from "@/features/containers/components/DispenseSheet";

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
