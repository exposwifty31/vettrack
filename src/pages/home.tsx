import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { TodayScreen } from "@/features/today";
import { Bdi } from "@/components/ui/bdi";
import { t, formatDateByLocale } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSection } from "@/components/ui/loading-section";
import { computeAlerts, formatRelativeTime } from "@/lib/utils";
import {
  buildAlertAckSet,
  countActiveAlerts,
  countCriticalAlerts,
} from "@/lib/alert-counts";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useAuth } from "@/hooks/use-auth";
import { TruncatedText } from "@/components/ui/truncated-text";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { QrScanner } from "@/components/qr-scanner";
import { getCurrentUserId } from "@/lib/auth-store";
import { subscribeKeepalive } from "@/lib/realtime";
import type { Appointment } from "@/types";
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  Plus,
  Scan,
  ShieldAlert,
  Siren,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterOnce } from "@/hooks/use-enter-once";
import {
  ShiftProgressHero,
  shiftProgressStatsFromHome,
} from "@/components/home/ShiftProgressHero";
import { pickNextDashboardTask } from "@/lib/task-dashboard-filters";

/** Localized "5h 12m" style duration. */
function humanizeMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return t.homePage.etaMinutes(Math.max(1, m));
  const hours = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? t.homePage.etaHours(hours) : `${t.homePage.etaHours(hours)} ${t.homePage.etaMinutes(rem)}`;
}

/** Compact eta for the Next-up pill. */
function compactEta(min: number): string {
  if (min <= 1) return t.homePage.etaNow;
  if (min < 60) return t.homePage.etaMinutes(min);
  return t.homePage.etaHours(Math.round(min / 60));
}

export default function HomePage() {
  const inMobileShell = useMobileShellContext();
  if (inMobileShell) return <TodayScreen />;

  const { name, refreshAuth } = useAuth();
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activeCodeBlueId, setActiveCodeBlueId] = useState<string | null>(null);
  const searchStr = useSearch();
  const enterOnce = useEnterOnce("home");
  const rise = enterOnce ? "vt-pro-rise" : "";

  useRealtimeReconciliation({ queryClient });

  useEffect(() => subscribeKeepalive(({ activeCodeBlueSessionId }) => {
    setActiveCodeBlueId(activeCodeBlueSessionId);
  }), []);

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    if (params.get("scan") === "1") {
      setScannerOpen(true);
    }
  }, [searchStr]);

  const { data: equipment, isLoading: equipmentLoading, isError: equipmentError, refetch } = useQuery({
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


  const { data: pulse } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 120_000,
  });

  const { data: alertAcks } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertAckSet = buildAlertAckSet(alertAcks);
  const alertCount = countActiveAlerts(alerts, alertAckSet);
  const criticalCount = countCriticalAlerts(alerts, alertAckSet);
  const overdueCount = taskDashboard?.counts.overdue ?? 0;
  const totalCount = equipment?.length ?? 0;
  const activePatientsCount = 0;

  const tasksDone = pulse?.tasksCompletedToday ?? 0;
  const tasksOpen = (taskDashboard?.counts.today ?? 0) + (taskDashboard?.counts.overdue ?? 0);
  const tasksTotal = tasksDone + tasksOpen;
  const scansDone = pulse?.scansToday ?? 0;

  const heroPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;
  const taskProgress = tasksTotal > 0 ? tasksDone / tasksTotal : 0;

  const microWins: string[] = [];
  if (alertCount === 0 && totalCount > 0) microWins.push(t.homePage.winNoAlerts);
  if (tasksOpen === 0 && tasksDone > 0) microWins.push(t.homePage.winTasksClear);
  if (scansDone > 0) microWins.push(t.homePage.winScansToday(scansDone));

  const firstName = name?.split(" ")[0] || t.homePage.fallbackName;
  const dateChip = formatDateByLocale(new Date(), { weekday: "short", day: "numeric", month: "short" });

  let shiftLine = t.homePage.shiftLineFallback;
  if (pulse?.shift) {
    const elapsedMin = Math.round((Date.now() - new Date(pulse.shift.startedAt).getTime()) / 60_000);
    if (elapsedMin <= 24 * 60) {
      shiftLine = t.homePage.shiftLine(humanizeMinutes(elapsedMin));
    }
  }

  const nextTask: Appointment | null = taskDashboard
    ? pickNextDashboardTask(taskDashboard)
    : null;

  let nextEtaMin = 0;
  let nextOverdue = false;
  if (nextTask) {
    nextEtaMin = Math.round((new Date(nextTask.endTime).getTime() - Date.now()) / 60_000);
    nextOverdue = nextEtaMin < 0;
  }
  const nextTitle = nextTask?.notes?.trim() || t.homePage.taskFallbackTitle;
  const nextPill = nextOverdue ? t.homePage.etaOverdue : compactEta(nextEtaMin);
  const nextBody = nextTask
    ? nextOverdue
      ? t.homePage.nextUpOverdueBy(humanizeMinutes(-nextEtaMin))
      : t.homePage.nextUpDueIn(humanizeMinutes(nextEtaMin))
    : "";

  const activityItems = activityData?.items ?? [];
  const todayItems = activityItems.slice(0, 6);

  const isDesktop = useIsDesktop();
  const heroPctDisplay = heroPct ?? 0;

  const pageContent = (
    <>
      <Helmet>
        <title>Dashboard — VetTrack</title>
        <meta
          name="description"
          content="Real-time veterinary equipment dashboard. View status at a glance, scan QR codes, triage active alerts, and track checked-out equipment across your clinic."
        />
        <link rel="canonical" href="https://vettrack.replit.app/" />
      </Helmet>

      <div
        className="vt-enter-stagger relative mx-auto flex w-full max-w-[680px] flex-col gap-3.5 px-3 pb-nav-safe pt-2 sm:px-5"
      >
        {/* Greeting — glance only */}
        <header className={cn("flex items-start justify-between gap-3 pt-3", rise)}>
          <div className="min-w-0 flex-1 space-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 vt-text-2xs font-semibold tracking-wide text-ivory-text2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              {dateChip}
            </span>
            <h1 className="truncate vt-page-title sm:vt-display text-ivory-text">
              {t.homePage.helloBeforeName}
              <Bdi>{firstName}</Bdi>
              {t.homePage.helloAfterName}
            </h1>
            <p className="vt-text-sm text-ivory-text3">{shiftLine}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/handoff")}
            aria-label={t.home.shiftSummary}
            data-testid="btn-shift-summary"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ivory-border bg-ivory-surface text-ivory-text2 shadow-sm transition-all hover:border-primary/30 hover:text-foreground motion-safe:active:scale-95"
          >
            <ClipboardCheck className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </header>

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

        {/* Urgent item — answer-first lead (Code Blue > critical alert > overdue task) */}
        {(activeCodeBlueId || criticalCount > 0 || overdueCount > 0) && !equipmentLoading && (
          <Link
            href={activeCodeBlueId ? "/code-blue" : criticalCount > 0 ? "/alerts" : "/equipment/tasks"}
            className={cn(
              "relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3.5 shadow-card transition-opacity motion-safe:active:scale-[0.99]",
              activeCodeBlueId
                ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30"
                : criticalCount > 0
                ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30"
                : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30"
            )}
          >
            <span
              className={cn(
                "absolute inset-y-3 start-0 w-[3px] rounded-full",
                activeCodeBlueId || criticalCount > 0 ? "bg-red-500" : "bg-amber-500"
              )}
              aria-hidden
            />
            <span
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                activeCodeBlueId || criticalCount > 0
                  ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                  : "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
              )}
            >
              {activeCodeBlueId
                ? <Siren className="h-4 w-4" aria-hidden />
                : <AlertTriangle className="h-4 w-4" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 ps-1">
              <span
                className={cn(
                  "block vt-text-sm font-bold",
                  activeCodeBlueId || criticalCount > 0
                    ? "text-red-700 dark:text-red-300"
                    : "text-amber-700 dark:text-amber-300"
                )}
              >
                {activeCodeBlueId
                  ? t.homePage.urgentCodeBlue
                  : criticalCount > 0
                  ? t.homePage.urgentCriticalAlerts(criticalCount)
                  : t.homePage.urgentOverdueTasks(overdueCount)}
              </span>
              <span className="block vt-text-xs text-ivory-text3">
                {activeCodeBlueId
                  ? t.homePage.urgentCodeBlueHint
                  : criticalCount > 0
                  ? t.homePage.urgentCriticalAlertsHint
                  : t.homePage.urgentOverdueTasksHint}
              </span>
            </span>
            <ForwardChevron className="h-4 w-4 shrink-0 text-ivory-text3" aria-hidden />
          </Link>
        )}

        {/* V4 Pro — shift progress hero */}
        <div className={rise}>
          <ShiftProgressHero
            progressPct={heroPctDisplay}
            progressLabel={t.homePage.progressLabel}
            stats={shiftProgressStatsFromHome({
              tasksDone,
              tasksTotal,
              scansDone,
              activePatients: activePatientsCount,
            })}
            animateRing={enterOnce}
          />
          {microWins.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {microWins.map((label) => (
                <span
                  key={label}
                  className="inline-flex max-w-full items-center whitespace-nowrap rounded-full border border-[var(--action-border)] bg-[var(--action-soft)] px-2.5 py-1 vt-text-2xs font-semibold text-[var(--action-ink)]"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Next up — the thumb-zone hero */}
        <section className={cn("rounded-[20px] border border-ivory-border border-s-[3px] border-s-[var(--brand)] bg-ivory-surface p-4 shadow-card", rise)}>
          <div className="ps-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2.5">
              <span className="vt-text-2xs font-bold uppercase tracking-[0.16em] text-brand">
                {t.homePage.nextUp}
              </span>
              {nextTask && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 vt-text-2xs font-bold tabular-nums ${
                    nextOverdue
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-ivory-text3"
                  }`}
                >
                  <Clock className="h-2.5 w-2.5" aria-hidden />
                  {nextPill}
                </span>
              )}
            </div>

            {tasksLoading && !taskDashboard ? (
              <div className="space-y-2 py-1">
                <div className="h-5 w-2/3 rounded bg-muted" />
                <div className="h-3.5 w-1/3 rounded bg-muted" />
              </div>
            ) : nextTask ? (
              <>
                <h2 className="mb-1 vt-text-lg font-bold leading-snug tracking-tight text-ivory-text">
                  {nextTitle}
                </h2>
                <p className="mb-3.5 vt-text-sm text-ivory-text3">{nextBody}</p>
                <Link
                  href="/equipment/tasks"
                  data-testid="btn-next-up"
                  className="flex h-[60px] w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-deep)] vt-text-sm font-bold text-white shadow-lg transition-transform motion-safe:active:scale-[0.98]"
                  style={{
                    boxShadow: "0 10px 22px -10px color-mix(in srgb, var(--brand) 55%, transparent)",
                  }}
                >
                  {t.homePage.nextUpStart}
                  <ForwardChevron className="h-[18px] w-[18px]" aria-hidden />
                </Link>
              </>
            ) : (
              <>
                <h2 className="mb-1 vt-text-lg font-bold leading-snug tracking-tight text-ivory-text">
                  {t.homePage.nextUpEmpty}
                </h2>
                <p className="mb-3.5 vt-text-sm text-ivory-text3">{t.homePage.nextUpEmptyBody}</p>
                <Link
                  href="/equipment/tasks"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-ivory-border bg-ivory-surface text-sm font-semibold text-ivory-text2 transition-colors hover:text-foreground motion-safe:active:scale-[0.98]"
                >
                  {t.homePage.nextUpEmptyCta}
                  <ForwardChevron className="h-4 w-4" aria-hidden />
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Quick actions — desktop only; mobile uses bottom nav scan + menu */}
        {isDesktop && (
          <section>
            <p className="mb-2 vt-text-2xs font-bold uppercase tracking-[0.18em] text-ivory-text3">
              {t.homePage.orLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                data-testid="quick-action-scan"
                className="vt-action-green flex min-h-[76px] items-center justify-between gap-2.5 rounded-2xl p-3.5 text-start text-white transition-transform motion-safe:active:scale-[0.98]"
              >
                <span className="min-w-0">
                  <span className="block vt-text-sm font-bold">{t.homePage.scanEquipment}</span>
                  <span className="mt-0.5 block vt-text-2xs text-white">{t.homePage.scanEquipmentHint}</span>
                </span>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <Scan className="h-[17px] w-[17px]" aria-hidden />
                </span>
              </button>

              <Link
                href="/alerts"
                data-testid="quick-action-alerts"
                className="flex min-h-[76px] items-center justify-between gap-2.5 rounded-2xl border border-ivory-border bg-ivory-surface p-3.5 text-start shadow-sm transition-colors hover:border-primary/30 motion-safe:active:scale-[0.98]"
              >
                <span className="min-w-0">
                  <span className="block vt-text-sm font-bold text-ivory-text">{t.homePage.triageAlerts}</span>
                  <span className="mt-0.5 block vt-text-xs text-ivory-text3">
                    {alertCount > 0 ? t.homePage.triageAlertsHint(alertCount) : t.homePage.triageAlertsClear}
                  </span>
                </span>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-brand">
                  <ShieldAlert className="h-[17px] w-[17px]" aria-hidden />
                </span>
              </Link>
            </div>
          </section>
        )}

        {/* Get started — brand-new clinic with no equipment yet */}
        {!equipmentLoading && totalCount === 0 && (
          <div className="rounded-2xl border border-ivory-border bg-ivory-surface p-5 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Plus className="h-6 w-6 text-foreground/70" aria-hidden />
            </div>
            <h3 className="mb-1 vt-text-lg font-bold text-ivory-text">{t.homePage.getStarted}</h3>
            <p className="mb-4 vt-text-sm text-ivory-text3">{t.homePage.getStartedDescription}</p>
            <Link
              href="/equipment/new"
              data-testid="btn-get-started"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-deep)] px-5 text-sm font-bold text-white"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t.home.addEquipment}
            </Link>
          </div>
        )}

        {/* Today */}
        <section>
          <p className="mb-2 vt-text-2xs font-bold uppercase tracking-[0.18em] text-ivory-text3">
            {t.homePage.todayLabel}
          </p>
          {activityLoading ? (
            <LoadingSection rows={4} />
          ) : todayItems.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-ivory-border bg-ivory-surface">
              {todayItems.map((item, i) => (
                <Link
                  key={item.id}
                  href={`/equipment/${item.equipmentId}`}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/50 ${
                    i === todayItems.length - 1 ? "" : "border-b border-ivory-border/60"
                  }`}
                >
                  <TruncatedText
                    text={item.equipmentName}
                    className="vt-text-sm text-ivory-text flex-1"
                  />
                  <span className="shrink-0 vt-text-2xs tabular-nums text-ivory-text3">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-ivory-border bg-ivory-surface">
              <EmptyState
                icon={Activity}
                message={t.homePage.activityFeedEmpty}
                subMessage={t.homePage.activityFeedEmptyHint}
              />
            </div>
          )}
        </section>
      </div>

      {scannerOpen && <QrScanner onClose={() => setScannerOpen(false)} />}

    </>
  );

  return (
    <AppShell
      onScan={() => setScannerOpen(true)}
      scannerOpen={scannerOpen}
      onCloseScan={() => setScannerOpen(false)}
    >
      {pageContent}
    </AppShell>
  );
}
