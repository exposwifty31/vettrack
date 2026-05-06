import { t, formatDateByLocale } from "@/lib/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { ErrorCard } from "@/components/ui/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { useMemo, useState } from "react";
import type { BillingLedgerEntry } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { Receipt, ReceiptText, Plus, Ban, Search, Sparkles, AlertTriangle, CalendarDays, Clock3, X, TrendingUp, Clock, CheckCircle2, XCircle, ShieldAlert, TrendingDown, PackageX, Siren, Boxes } from "lucide-react";
import { Link } from "wouter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const STATUS_BADGE: Record<BillingLedgerEntry["status"], string> = {
  pending:
    "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/55 dark:text-amber-100 dark:border-amber-800",
  synced:
    "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950/55 dark:text-emerald-100 dark:border-emerald-800",
  voided: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<BillingLedgerEntry["status"], string> = {
  pending: "ממתין",
  synced: "מסונכרן",
  voided: "מבוטל",
};

function formatCents(cents: number): string {
  return `₪${(cents / 100).toFixed(2)}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

type DateRange = "today" | "week" | "month" | "all";

function getDateRange(range: DateRange): { from?: string; to?: string } {
  const now = new Date();
  const toIso = (d: Date) => d.toISOString();
  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: toIso(start), to: toIso(now) };
  }
  if (range === "week") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: toIso(start), to: toIso(now) };
  }
  if (range === "month") {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: toIso(start), to: toIso(now) };
  }
  return {};
}

const PAGE_SIZE = 50;

export default function BillingLedgerPage() {
  const qc = useQueryClient();
  const p = t.billingLedger;
  const { userId, isAdmin, role } = useAuth();

  const [dateRange, setDateRange] = useState<DateRange>("month");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<BillingLedgerEntry | null>(null);

  const [form, setForm] = useState({
    animalId: "",
    itemType: "CONSUMABLE" as "EQUIPMENT" | "CONSUMABLE",
    itemId: "",
    quantity: 1,
    unitPriceCents: 0,
  });

  const dateParams = useMemo(() => getDateRange(dateRange), [dateRange]);

  const summaryQ = useQuery({
    queryKey: ["/api/billing/summary", dateParams],
    queryFn: () => api.billing.summary(dateParams),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const ledgerQ = useQuery({
    queryKey: ["/api/billing", statusFilter, dateParams],
    queryFn: () =>
      api.billing.list({
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...dateParams,
        limit: 500,
      }),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.billing.create({
        animalId: form.animalId.trim() || undefined,
        itemType: form.itemType,
        itemId: form.itemId.trim(),
        quantity: form.quantity,
        unitPriceCents: form.unitPriceCents,
      }),
    onSuccess: () => {
      toast.success(p.chargeAdded, { duration: 3200 });
      qc.invalidateQueries({ queryKey: ["/api/billing"] });
      setAddOpen(false);
      setForm({ animalId: "", itemType: "CONSUMABLE", itemId: "", quantity: 1, unitPriceCents: 0 });
    },
    onError: () => toast.error(p.chargeAddFailed),
  });

  const voidMut = useMutation({
    mutationFn: (id: string) => api.billing.void(id),
    onSuccess: () => {
      toast.success(p.chargeVoided, { duration: 3200 });
      qc.invalidateQueries({ queryKey: ["/api/billing"] });
      setVoidTarget(null);
    },
    onError: () => toast.error(p.chargeVoidFailed),
  });

  const allEntries = ledgerQ.data ?? [];

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const nonVoidedEntries = useMemo(() => allEntries.filter((entry) => entry.status !== "voided"), [allEntries]);
  const chargesToday = useMemo(
    () =>
      nonVoidedEntries
        .filter((entry) => new Date(entry.createdAt) >= todayStart)
        .reduce((sum, entry) => sum + entry.totalAmountCents, 0),
    [nonVoidedEntries, todayStart],
  );
  const chargesThisWeek = useMemo(
    () =>
      nonVoidedEntries
        .filter((entry) => new Date(entry.createdAt) >= weekStart)
        .reduce((sum, entry) => sum + entry.totalAmountCents, 0),
    [nonVoidedEntries, weekStart],
  );
  const autoCapturedEntries = useMemo(
    () => nonVoidedEntries.filter((entry) => entry.status === "synced"),
    [nonVoidedEntries],
  );
  const autoCapturedTotal = useMemo(
    () => autoCapturedEntries.reduce((sum, entry) => sum + entry.totalAmountCents, 0),
    [autoCapturedEntries],
  );
  const outstandingReviewEntries = useMemo(
    () => nonVoidedEntries.filter((entry) => entry.status === "pending"),
    [nonVoidedEntries],
  );
  const outstandingReviewTotal = useMemo(
    () => outstandingReviewEntries.reduce((sum, entry) => sum + entry.totalAmountCents, 0),
    [outstandingReviewEntries],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    return allEntries.filter((e) => {
      if (typeFilter === "EQUIPMENT" && e.itemType !== "EQUIPMENT") return false;
      if (typeFilter === "CONSUMABLE" && e.itemType !== "CONSUMABLE") return false;
      if (normalizedSearch) {
        const createdDate = formatDateByLocale(e.createdAt).toLowerCase();
        return (
          (e.animalId ?? "").toLowerCase().includes(normalizedSearch) ||
          e.itemId.toLowerCase().includes(normalizedSearch) ||
          e.itemType.toLowerCase().includes(normalizedSearch) ||
          e.status.toLowerCase().includes(normalizedSearch) ||
          createdDate.includes(normalizedSearch)
        );
      }
      return true;
    });
  }, [allEntries, typeFilter, normalizedSearch]);

  const visibleEntries = filteredEntries.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = filteredEntries.length > visibleEntries.length;

  const summary = summaryQ.data;
  const chartData = summary?.byDay.map((d) => ({
    date: formatShortDate(d.date),
    amount: d.totalCents / 100,
  })) ?? [];

  const rangeButtons: { key: DateRange; label: string }[] = [
    { key: "today", label: p.rangeToday },
    { key: "week", label: p.rangeWeek },
    { key: "month", label: p.rangeMonth },
    { key: "all", label: p.rangeAll },
  ];

  const BILLING_SIDEBAR: SidebarItem[] = [
    { href: "/billing",                icon: ReceiptText,  label: "לוח חיובים" },
    { href: "/billing/leakage",        icon: TrendingDown, label: "דוח דליפות" },
    { href: "/billing/inventory-jobs", icon: Boxes,        label: "עבודות מלאי" },
  ];

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <Helmet>
        <title>{p.title} — VetTrack</title>
      </Helmet>

      <div className="w-full space-y-6 motion-safe:animate-page-enter">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Receipt className="h-7 w-7 shrink-0 text-primary" aria-hidden />
            <h1 className="truncate text-2xl font-bold tracking-tight">{p.title}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/billing/leakage">
              <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs">
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                דוח דליפות
              </Button>
            </Link>
            {role === "admin" && (
              <Link href="/billing/inventory-jobs">
                <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs">
                  <PackageX className="h-3.5 w-3.5 text-orange-500" />
                  עבודות מלאי
                </Button>
              </Link>
            )}
            {role === "admin" && (
              <Link href="/billing/code-blue-reconciliation">
                <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs">
                  <Siren className="h-3.5 w-3.5 text-destructive" />
                  קוד כחול
                </Button>
              </Link>
            )}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {rangeButtons.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setDateRange(key); setPage(0); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    dateRange === key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Link href="/billing/leakage">
              <Button variant="outline" size="sm" className="min-h-[40px] shrink-0">
                <ShieldAlert className="h-4 w-4 mr-1" />
                דוח דליפות
              </Button>
            </Link>
            {isAdmin && (
              <Button size="sm" className="min-h-[40px] shrink-0" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {p.addCharge}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:hover:shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">חיובים היום</p>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{formatCents(chargesToday)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{nonVoidedEntries.length} שורות פעילות</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:hover:shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">חיובים השבוע</p>
              <Clock3 className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{formatCents(chargesThisWeek)}</p>
            <p className="mt-1 text-xs text-muted-foreground">סה״כ 7 ימים אחרונים</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:hover:shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-emerald-700">מסונכרן אוטומטית</p>
              <Sparkles className="h-4 w-4 text-emerald-700" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-800">
              {formatCents(autoCapturedTotal)}
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              {autoCapturedEntries.length} רשומות מסונכרנות לחיצוני
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:hover:shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-amber-700">ממתין לסקירה</p>
              <AlertTriangle className="h-4 w-4 text-amber-700" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-800">
              {outstandingReviewEntries.length}
            </p>
            <p className="mt-1 text-xs text-amber-700">{formatCents(outstandingReviewTotal)} ממתין לסקירה</p>
          </div>
        </div>

        {/* Bar Chart */}
        {!summaryQ.isPending && !summaryQ.isError && chartData.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold text-foreground mb-3">{p.chartTitle}</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₪${v}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`₪${value.toFixed(2)}`, ""]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="amount" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Search + type + status filters */}
        <div className="rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                  placeholder="חיפוש לפי מזהה חיה, מזהה פריט, סטטוס, תאריך או סוג"
                  className="pl-9 pr-8"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="נקה חיפוש"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
                <SelectTrigger className="w-36 h-9 text-xs bg-background">
                  <SelectValue placeholder={p.filterType} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{p.type_all}</SelectItem>
                  <SelectItem value="EQUIPMENT">{p.type_equipment}</SelectItem>
                  <SelectItem value="CONSUMABLE">{p.type_consumable}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              {["all", "pending", "synced", "voided"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatusFilter(s); setPage(0); }}
                  className={`min-h-[36px] rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {p[`filter_${s}` as keyof typeof p] ?? s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Ledger */}
        {ledgerQ.isPending ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[4.25rem] w-full rounded-2xl" />
            ))}
          </div>
        ) : ledgerQ.isError ? (
          <ErrorCard message={p.loadError} onRetry={() => ledgerQ.refetch()} />
        ) : visibleEntries.length === 0 ? (
          <EmptyState
            icon={Receipt}
            message={p.noEntries}
            subMessage="חיובים ידניים ורשומות מסונכרנות יופיעו כאן לאחר שיירשמו."
            iconBg="bg-muted/80 ring-1 ring-border/40"
            iconColor="text-muted-foreground"
          />
        ) : (
          <div className="space-y-3">
            <div className="hidden overflow-hidden rounded-xl border lg:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">{p.colAnimal}</th>
                    <th className="text-left px-4 py-3 font-semibold">{p.colType}</th>
                    <th className="text-left px-4 py-3 font-semibold">{p.colQty}</th>
                    <th className="text-left px-4 py-3 font-semibold">{p.colUnit}</th>
                    <th className="text-left px-4 py-3 font-semibold">{p.colTotal}</th>
                    <th className="text-left px-4 py-3 font-semibold">{p.colStatus}</th>
                    <th className="text-left px-4 py-3 font-semibold">{p.colDate}</th>
                    {isAdmin && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleEntries.map((entry) => (
                    <tr key={entry.id} className={entry.status === "voided" ? "opacity-50" : ""}>
                      <td className="px-4 py-3 font-mono text-xs">{entry.animalId}</td>
                      <td className="px-4 py-3">{entry.itemType}</td>
                      <td className="px-4 py-3">{entry.quantity}</td>
                      <td className="px-4 py-3">{formatCents(entry.unitPriceCents)}</td>
                      <td className="px-4 py-3 font-semibold">
                        <span className={entry.status === "synced" ? "text-emerald-700" : ""}>
                          {formatCents(entry.totalAmountCents)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_BADGE[entry.status]}`}>
                          {STATUS_LABEL[entry.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatDateByLocale(entry.createdAt)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          {entry.status !== "voided" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive h-7 px-2"
                              onClick={() => setVoidTarget(entry)}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 lg:hidden">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-xl border bg-card p-4 shadow-sm ${entry.status === "voided" ? "opacity-60" : ""} ${
                    entry.status === "synced" ? "border-emerald-200 bg-emerald-50/50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="break-all font-mono text-xs text-muted-foreground">{entry.animalId}</p>
                      <p className="text-sm font-medium">{entry.itemType}</p>
                      <p className="text-xs text-muted-foreground">{formatDateByLocale(entry.createdAt)}</p>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_BADGE[entry.status]}`}>
                      {STATUS_LABEL[entry.status]}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border bg-background p-2">
                      <p className="text-muted-foreground">Qty</p>
                      <p className="font-semibold">{entry.quantity}</p>
                    </div>
                    <div className="rounded-lg border bg-background p-2">
                      <p className="text-muted-foreground">Unit</p>
                      <p className="font-semibold">{formatCents(entry.unitPriceCents)}</p>
                    </div>
                    <div className="col-span-2 rounded-lg border bg-background p-2">
                      <p className="text-muted-foreground">Total</p>
                      <p className={`text-base font-semibold ${entry.status === "synced" ? "text-emerald-700" : ""}`}>
                        {formatCents(entry.totalAmountCents)}
                      </p>
                    </div>
                  </div>
                  {isAdmin && entry.status !== "voided" ? (
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-8 px-2"
                        onClick={() => setVoidTarget(entry)}
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        {p.voidConfirm}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((pg) => pg + 1)}
                >
                  {p.loadMore}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add charge dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{p.addCharge}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{p.fieldAnimalId}</Label>
              <Input
                value={form.animalId}
                onChange={(e) => setForm((f) => ({ ...f, animalId: e.target.value }))}
                placeholder={p.fieldAnimalIdPlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label>{p.fieldItemType}</Label>
              <Select
                value={form.itemType}
                onValueChange={(v) => setForm((f) => ({ ...f, itemType: v as "EQUIPMENT" | "CONSUMABLE" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EQUIPMENT">{p.type_equipment}</SelectItem>
                  <SelectItem value="CONSUMABLE">{p.type_consumable}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{p.fieldItemId}</Label>
              <Input
                value={form.itemId}
                onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}
                placeholder={p.fieldItemIdPlaceholder}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{p.colQty}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{p.fieldUnitCents}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.unitPriceCents}
                  onChange={(e) => setForm((f) => ({ ...f, unitPriceCents: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{p.cancel}</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.itemId}
            >
              {createMut.isPending ? p.saving : p.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void confirmation */}
      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.voidTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {p.voidDescription} {voidTarget ? formatCents(voidTarget.totalAmountCents) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{p.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => voidTarget && voidMut.mutate(voidTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {p.voidConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  if (isDesktop) {
    return <PageShell sidebarItems={BILLING_SIDEBAR}>{pageContent}</PageShell>;
  }
  return <Layout>{pageContent}</Layout>;
}
