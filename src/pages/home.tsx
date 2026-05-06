import { t } from "@/lib/i18n";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSection } from "@/components/ui/loading-section";
import { ShiftSummarySheet } from "@/components/shift-summary-sheet";
import { computeAlerts } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Plus,
  Zap,
  Scan,
  ClipboardCheck,
  Activity,
  DollarSign,
  Users,
  ListTodo,
  Boxes,
  ArrowUpRight,
  Receipt,
  BadgePlus,
  ShieldAlert,
  Sparkles,
  FilePlus2,
  Droplets,
  type LucideIcon,
  Film,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatRelativeTime } from "@/lib/utils";
import { QrScanner } from "@/components/qr-scanner";
import { getCurrentUserId } from "@/lib/auth-store";

const STATUS_ICON_MAP: Record<string, React.ElementType> = {
  ok: CheckCircle2,
  issue: AlertTriangle,
  maintenance: Wrench,
  sterilized: Droplets,
};

const STATUS_COLOR_MAP: Record<string, string> = {
  ok: "text-primary",
  issue: "text-destructive",
  maintenance: "text-muted-foreground",
  sterilized: "text-foreground",
};

export default function HomePage() {
  const { name, refreshAuth } = useAuth();
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);
  const searchStr = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    if (params.get("scan") === "1") {
      setScannerOpen(true);
    }
  }, [searchStr]);

  const { data: equipment, isLoading, isError: equipmentError, refetch } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: () => api.activity.feed(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: taskDashboard, isLoading: tasksLoading } = useQuery({
    queryKey: ["/api/tasks/dashboard", userId ?? ""],
    queryFn: () => api.tasks.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: shiftTotal, isLoading: shiftLoading } = useQuery({
    queryKey: ["/api/billing/shift-total"],
    queryFn: () => api.billing.shiftTotal(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000,
  });

  const { data: patientsData, isLoading: patientsLoading } = useQuery({
    queryKey: ["/api/patients"],
    queryFn: () => api.patients.list({}),
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertCount = alerts.length;
  const totalCount = equipment?.length ?? 0;
  const tasksDueCount =
    taskDashboard ? taskDashboard.counts.today + taskDashboard.counts.overdue : null;
  const activePatientsCount = patientsData
    ? patientsData.patients.length
    : null;

  const kpiCards: Array<{
    id: string;
    title: string;
    value: number | string | null;
    subtitle: string;
    icon: LucideIcon;
    href?: string;
    loading: boolean;
  }> = [
    {
      id: "active-patients",
      title: "מטופלים פעילים",
      value: activePatientsCount,
      subtitle: "בטיפול פעיל",
      icon: Users,
      href: "/patients",
      loading: patientsLoading,
    },
    {
      id: "tasks-due",
      title: "משימות לביצוע",
      value: tasksDueCount,
      subtitle: "היום + באיחור",
      icon: ListTodo,
      href: "/appointments",
      loading: tasksLoading,
    },
    {
      id: "inventory-alerts",
      title: "התראות מלאי",
      value: alertCount,
      subtitle: alertCount > 0 ? "דורש בדיקה" : "הכל תקין",
      icon: ShieldAlert,
      href: "/alerts",
      loading: isLoading,
    },
    {
      id: "charges-today",
      title: "נרשם במשמרת זו",
      value: shiftTotal?.shiftActive
        ? `₪${(shiftTotal.totalCents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`
        : null,
      subtitle: shiftTotal?.shiftActive ? "רשומות חיוב במשמרת" : "אין משמרת פתוחה",
      icon: DollarSign,
      href: "/billing",
      loading: shiftLoading,
    },
  ];

  const quickActions: Array<{
    id: string;
    label: string;
    hint: string;
    icon: LucideIcon;
    href?: string;
    onClick?: () => void;
  }> = [
    {
      id: "scan",
      label: "סריקה",
      hint: "QR או NFC",
      icon: Scan,
      onClick: () => setScannerOpen(true),
    },
    {
      id: "add-task",
      label: "הוסף משימה",
      hint: "צור או שייך",
      icon: FilePlus2,
      href: "/appointments",
    },
    {
      id: "inventory",
      label: "מלאי",
      hint: "מלאי ונכסים",
      icon: Boxes,
      href: "/inventory",
    },
    {
      id: "billing",
      label: "חיובים",
      hint: "חיובים ופנקס",
      icon: Receipt,
      href: "/billing",
    },
    {
      id: "app-tour",
      label: t.layoutHebrew.appTour,
      hint: t.homePage.appTourHint,
      icon: Film,
      href: "/app-tour",
    },
  ];

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <Helmet>
        <title>Dashboard — VetTrack</title>
        <meta name="description" content="Real-time veterinary equipment dashboard. View status at a glance, scan QR codes, triage active alerts, and track checked-out equipment across your clinic." />
        <link rel="canonical" href="https://vettrack.replit.app/" />
      </Helmet>
      <div className="motion-safe:animate-page-enter pb-8">
        <div className="flex w-full flex-col gap-5">
          <section className="rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/30 px-4 py-4 shadow-sm sm:px-5 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  היום
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {t.homePage.greeting(name?.split(" ")[0] || t.homePage.fallbackName)}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t.home.equipmentOverview}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[40px] w-full shrink-0 gap-1.5 self-stretch border-border/70 bg-background/70 text-xs text-muted-foreground hover:text-foreground sm:mt-1 sm:w-auto sm:self-auto"
                onClick={() => setShiftSummaryOpen(true)}
                data-testid="btn-shift-summary"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                {t.home.shiftSummary}
              </Button>
            </div>
          </section>

          {equipmentError && (
            <ErrorCard
              message={t.equipmentList.errors.loadFailed}
              onRetry={() => {
                queryClient.clear();
                refreshAuth();
                refetch();
              }}
            />
          )}

          {shiftTotal?.shiftActive && shiftTotal.totalCents > 0 && (
            <Link href="/billing">
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                data-testid="shift-capture-badge"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/20">
                    <BadgePlus className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
                      ₪{(shiftTotal.totalCents / 100).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} captured this shift
                    </p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
                      {shiftTotal.count} {shiftTotal.count === 1 ? "item" : "items"} billed
                    </p>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-emerald-600/70 dark:text-emerald-400/70" />
              </div>
            </Link>
          )}

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map((card) => {
              const CardIcon = card.icon;
              const content = (
                <Card
                  className="h-full border-border/60 bg-card/95 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  data-testid={`kpi-${card.id}`}
                >
                  <CardContent className="flex min-h-[120px] flex-col justify-between p-4 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {card.title}
                      </p>
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-muted/60">
                        <CardIcon className="h-4 w-4 text-foreground/80" />
                      </span>
                    </div>
                    <div className="space-y-1">
                      {card.loading ? (
                        <Skeleton className="h-8 w-20" />
                      ) : (
                        <p className="text-3xl font-semibold leading-none tracking-tight text-foreground">
                          {card.value ?? "—"}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{card.subtitle}</p>
                    </div>
                  </CardContent>
                </Card>
              );
              if (card.href) {
                return (
                  <Link key={card.id} href={card.href}>
                    {content}
                  </Link>
                );
              }
              return <div key={card.id}>{content}</div>;
            })}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => {
              const ActionIcon = action.icon;
              const actionContent = (
                <Card
                  className="group border-border/60 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  data-testid={`quick-action-${action.id}`}
                >
                  <CardContent className="flex min-h-[88px] items-center justify-between gap-2.5 p-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-foreground">{action.label}</p>
                      <p className="text-xs text-muted-foreground">{action.hint}</p>
                    </div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-muted/70">
                      <ActionIcon className="h-4 w-4 text-foreground/80" />
                    </span>
                  </CardContent>
                </Card>
              );

              if (action.href) {
                return (
                  <Link key={action.id} href={action.href}>
                    {actionContent}
                  </Link>
                );
              }
              return (
                <button
                  key={action.id}
                  type="button"
                  className="w-full text-start"
                  onClick={action.onClick}
                >
                  {actionContent}
                </button>
              );
            })}
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <Card className="border-border/60 bg-card shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                      <Activity className="h-4 w-4 text-primary" />
                      Live Activity
                    </h2>
                    <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] tabular-nums">
                      {(activityData?.items?.length ?? 0).toString()} events
                    </Badge>
                  </div>

                  {activityLoading ? (
                    <LoadingSection rows={4} />
                  ) : activityData?.items && activityData.items.length > 0 ? (
                    <div className="space-y-2">
                      {activityData.items.slice(0, 6).map((item) => {
                        const StatusIcon = STATUS_ICON_MAP[item.status ?? "ok"] ?? Activity;
                        const statusColor =
                          STATUS_COLOR_MAP[item.status ?? "ok"] ?? "text-muted-foreground";
                        const actionText =
                          item.type === "scan"
                            ? item.note ?? `Updated status to ${item.status}`
                            : item.note ?? `Moved to ${item.toFolder || "unfiled"}`;

                        return (
                          <Link key={item.id} href={`/equipment/${item.equipmentId}`}>
                            <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-3.5 transition-colors duration-200 hover:bg-muted/50 motion-safe:hover:shadow-sm">
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted">
                                  <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                                </span>
                                <div className="min-w-0 space-y-0.5">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {item.equipmentName}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">{actionText}</p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                                <p className="max-w-[4.5rem] truncate text-end text-[11px] tabular-nums text-muted-foreground sm:max-w-none sm:whitespace-nowrap">
                                  {formatRelativeTime(item.timestamp)}
                                </p>
                                <ArrowUpRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/80 sm:block" aria-hidden />
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState
                      icon={Activity}
                      message={t.homePage.activityFeedEmpty}
                      subMessage={t.homePage.activityFeedEmptyHint}
                    />
                  )}
                </CardContent>
              </Card>

              {!isLoading && totalCount === 0 && (
                <Card className="border-border/60 bg-card shadow-sm">
                  <CardContent className="p-6 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                      <Zap className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <h3 className="mb-1 text-lg font-bold">{t.homePage.getStarted}</h3>
                    <p className="mb-4 text-sm text-muted-foreground">
                      {t.homePage.getStartedDescription}
                    </p>
                    <Link href="/equipment/new">
                      <Button data-testid="btn-get-started">
                        <Plus className="mr-2 h-4 w-4" />
                        Add Equipment
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4 lg:col-span-5">
              <Card className="border-border/60 bg-card shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      Inventory Alerts
                    </h2>
                    <Link href="/alerts">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                        View all
                      </Button>
                    </Link>
                  </div>

                  {isLoading ? (
                    <LoadingSection rows={3} />
                  ) : alertCount > 0 ? (
                    <div className="space-y-2">
                      {alerts.slice(0, 4).map((alert) => (
                        <Link key={`${alert.type}-${alert.equipmentId}`} href={`/equipment/${alert.equipmentId}`}>
                          <div className="rounded-xl border border-border/60 bg-background/70 p-3.5 transition-colors hover:bg-muted/40">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-foreground">
                                {alert.equipmentName}
                              </p>
                              <Badge
                                variant={
                                  alert.type === "issue"
                                    ? "issue"
                                    : alert.type === "overdue"
                                      ? "maintenance"
                                      : "sterilized"
                                }
                                className="shrink-0 px-2 py-0.5 text-[10px]"
                              >
                                {alert.type === "sterilization_due"
                                  ? t.common.sterilization
                                  : alert.type.charAt(0).toUpperCase() + alert.type.slice(1)}
                              </Badge>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{alert.detail}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={CheckCircle2}
                      message={t.homePage.alertsEmpty}
                      subMessage={t.homePage.alertsEmptyHint}
                      iconBg="bg-emerald-500/10 ring-1 ring-emerald-500/25"
                      iconColor="text-emerald-600 dark:text-emerald-400"
                    />
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card shadow-sm">
                <CardContent className="p-4">
                  <h3 className="mb-2.5 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    <BadgePlus className="h-4 w-4 text-primary" />
                    At a glance
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Tracked equipment</span>
                      <span className="font-semibold text-foreground">{isLoading ? "—" : totalCount}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Tasks due now</span>
                      <span className="font-semibold text-foreground">
                        {tasksLoading ? "—" : tasksDueCount ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Billing today</span>
                      <span className="font-semibold text-foreground tabular-nums">—</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </div>

      {scannerOpen && (
        <QrScanner onClose={() => setScannerOpen(false)} />
      )}

      <ShiftSummarySheet
        open={shiftSummaryOpen}
        onClose={() => setShiftSummaryOpen(false)}
      />
    </>
  );
  if (isDesktop) {
    return <PageShell>{pageContent}</PageShell>;
  }
  return (
    <Layout
      onScan={() => setScannerOpen(true)}
      scannerOpen={scannerOpen}
      onCloseScan={() => setScannerOpen(false)}
    >
      {pageContent}
    </Layout>
  );
}
