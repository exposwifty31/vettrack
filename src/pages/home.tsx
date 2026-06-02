import { t, formatDateByLocale } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSection } from "@/components/ui/loading-section";
import { ShiftSummarySheet } from "@/components/shift-summary-sheet";
import { computeAlerts, formatRelativeTime } from "@/lib/utils";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useAuth } from "@/hooks/use-auth";
import { useDirection } from "@/hooks/useDirection";
import { QrScanner } from "@/components/qr-scanner";
import { getCurrentUserId } from "@/lib/auth-store";
import type { Appointment } from "@/types";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Plus,
  Scan,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Deep forest used for accent bars, primary CTAs, and the solid quick action. */
const FOREST = "#1a3d28";
const FOREST_MID = "#2d6b45";

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
  const { name, refreshAuth } = useAuth();
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const direction = useDirection();
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);
  const searchStr = useSearch();
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );

  useRealtimeReconciliation({ queryClient });

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

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertCount = alerts.length;
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
    shiftLine = t.homePage.shiftLine(humanizeMinutes(elapsedMin));
  }

  // Next-up task: most overdue first, then soonest due today, then upcoming.
  const nextTask: Appointment | null =
    taskDashboard?.overdue[0] ?? taskDashboard?.today[0] ?? taskDashboard?.upcoming[0] ?? null;

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

  const sectionFade = reduced ? "" : "motion-safe:animate-page-enter";
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

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
        className={`relative mx-auto flex w-full max-w-[680px] flex-col gap-3.5 px-3 pb-nav-safe pt-2 sm:px-5 ${sectionFade}`}
      >
        {/* Greeting — glance only */}
        <header className="flex items-start justify-between gap-3 pt-3">
          <div className="min-w-0 flex-1 space-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-ivory-text2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              {dateChip}
            </span>
            <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight text-ivory-text sm:text-[32px]">
              {t.homePage.hello(firstName)}
            </h1>
            <p className="text-sm text-ivory-text3">{shiftLine}</p>
          </div>
          <button
            type="button"
            onClick={() => setShiftSummaryOpen(true)}
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

        {/* Glance — single progress line (read-only, top zone) */}
        <section
          className="rounded-2xl border border-ivory-border bg-ivory-surface px-3.5 py-3 shadow-sm"
          aria-label={t.homePage.heroKicker}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ivory-text3">
              {t.homePage.heroKicker}
            </span>
            {heroPct !== null && (
              <span className="text-[11px] font-semibold tabular-nums text-ivory-text2">
                {t.homePage.progressComplete(heroPct)}
              </span>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-700"
              style={{ width: `${Math.max(0, Math.min(1, taskProgress)) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs tabular-nums text-ivory-text3">
            {t.homePage.glanceLine(tasksDone, tasksTotal, scansDone, activePatientsCount)}
          </p>
          {microWins.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {microWins.map((label) => (
                <span
                  key={label}
                  className="inline-flex max-w-full items-center whitespace-nowrap rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Next up — the thumb-zone hero */}
        <section className="relative overflow-hidden rounded-[20px] border border-ivory-border bg-ivory-surface p-4 shadow-card">
          <span
            className="absolute inset-y-3.5 start-0 w-[3px] rounded-full"
            style={{ background: `linear-gradient(180deg, ${FOREST}, ${FOREST_MID})` }}
            aria-hidden
          />
          <div className="ps-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: FOREST }}>
                {t.homePage.nextUp}
              </span>
              {nextTask && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold tabular-nums ${
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
                <h2 className="mb-1 text-[17px] font-bold leading-snug tracking-tight text-ivory-text sm:text-lg">
                  {nextTitle}
                </h2>
                <p className="mb-3.5 text-[12.5px] text-ivory-text3">{nextBody}</p>
                <Link
                  href="/appointments"
                  data-testid="btn-next-up"
                  className="flex h-[60px] w-full items-center justify-center gap-2.5 rounded-2xl text-[15px] font-bold text-white transition-transform motion-safe:active:scale-[0.98]"
                  style={{
                    background: `linear-gradient(135deg, ${FOREST} 0%, ${FOREST_MID} 100%)`,
                    boxShadow: "0 10px 22px -10px rgba(26,61,40,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  {t.homePage.nextUpStart}
                  <Chevron className="h-[18px] w-[18px]" aria-hidden />
                </Link>
              </>
            ) : (
              <>
                <h2 className="mb-1 text-[17px] font-bold leading-snug tracking-tight text-ivory-text sm:text-lg">
                  {t.homePage.nextUpEmpty}
                </h2>
                <p className="mb-3.5 text-[12.5px] text-ivory-text3">{t.homePage.nextUpEmptyBody}</p>
                <Link
                  href="/appointments"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-ivory-border bg-ivory-surface text-sm font-semibold text-ivory-text2 transition-colors hover:text-foreground motion-safe:active:scale-[0.98]"
                >
                  {t.homePage.nextUpEmptyCta}
                  <Chevron className="h-4 w-4" aria-hidden />
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Quick actions — desktop only; mobile uses bottom nav scan + menu */}
        {isDesktop && (
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ivory-text3">
              {t.homePage.orLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                data-testid="quick-action-scan"
                className="flex min-h-[76px] items-center justify-between gap-2.5 rounded-2xl p-3.5 text-start text-white transition-transform motion-safe:active:scale-[0.98]"
                style={{ background: FOREST, boxShadow: "0 10px 22px -12px rgba(26,61,40,0.45)" }}
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold">{t.homePage.scanEquipment}</span>
                  <span className="mt-0.5 block text-[11px] text-white/65">{t.homePage.scanEquipmentHint}</span>
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
                  <span className="block text-[13.5px] font-bold text-ivory-text">{t.homePage.triageAlerts}</span>
                  <span className="mt-0.5 block text-[11px] text-ivory-text3">
                    {alertCount > 0 ? t.homePage.triageAlertsHint(alertCount) : t.homePage.triageAlertsClear}
                  </span>
                </span>
                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted"
                  style={{ color: FOREST }}
                >
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
            <h3 className="mb-1 text-base font-bold text-ivory-text">{t.homePage.getStarted}</h3>
            <p className="mb-4 text-sm text-ivory-text3">{t.homePage.getStartedDescription}</p>
            <Link
              href="/equipment/new"
              data-testid="btn-get-started"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${FOREST} 0%, ${FOREST_MID} 100%)` }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t.home.addEquipment}
            </Link>
          </div>
        )}

        {/* Today */}
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ivory-text3">
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
                  <p className="min-w-0 flex-1 truncate text-[12.5px] text-ivory-text">{item.equipmentName}</p>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-ivory-text3">
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

      <ShiftSummarySheet open={shiftSummaryOpen} onClose={() => setShiftSummaryOpen(false)} />
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
