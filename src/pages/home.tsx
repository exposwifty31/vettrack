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
  Flame,
  Plus,
  Scan,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Deep forest used for accent bars, primary CTAs, and the solid quick action. */
const FOREST = "#1a3d28";
const FOREST_MID = "#2d6b45";

interface RingDatum {
  key: string;
  label: string;
  color: string;
  n: number;
  of: number;
  pct: number;
}

/** Eased count-up. Jumps straight to the value when reduced motion is on. */
function CountUp({ to, durationMs = 900, reduced }: { to: number; durationMs?: number; reduced: boolean }) {
  const [n, setN] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) {
      setN(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs, reduced]);
  return <>{n}</>;
}

/** Three concentric shift-progress arcs that draw in on mount. */
function ShiftRings({ rings, reduced }: { rings: RingDatum[]; reduced: boolean }) {
  const [drawn, setDrawn] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setDrawn(true);
      return;
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const cx = 110;
  const cy = 110;
  const radii = [86, 68, 50];

  return (
    <svg viewBox="0 0 220 220" className="h-36 w-36 shrink-0 sm:h-40 sm:w-40" aria-hidden="true">
      {rings.map((r, i) => {
        const radius = radii[i] ?? 50;
        const circ = 2 * Math.PI * radius;
        const pct = drawn ? Math.max(0, Math.min(1, r.pct)) : 0;
        return (
          <g key={r.key}>
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={11} />
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeWidth={11}
              strokeLinecap="round"
              strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`}
              strokeDashoffset={circ * 0.25}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={reduced ? undefined : { transition: "stroke-dasharray 1100ms cubic-bezier(0.34,1.56,0.64,1)" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

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

  const { data: patientsData } = useQuery({
    queryKey: ["/api/patients"],
    queryFn: () => api.patients.list({}),
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
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
  const activePatientsCount = patientsData?.patients.length ?? 0;

  const tasksDone = pulse?.tasksCompletedToday ?? 0;
  const tasksOpen = (taskDashboard?.counts.today ?? 0) + (taskDashboard?.counts.overdue ?? 0);
  const tasksTotal = tasksDone + tasksOpen;
  const scansDone = pulse?.scansToday ?? 0;

  const rings: RingDatum[] = [
    {
      key: "tasks",
      label: t.homePage.ringTasks,
      color: "#6ba888",
      n: tasksDone,
      of: tasksTotal,
      pct: tasksTotal > 0 ? tasksDone / tasksTotal : 0,
    },
    {
      key: "scans",
      label: t.homePage.ringScans,
      color: "#9aa8a2",
      n: scansDone,
      of: totalCount,
      pct: totalCount > 0 ? Math.min(1, scansDone / totalCount) : 0,
    },
    {
      key: "patients",
      label: t.homePage.ringPatients,
      color: "#c2a981",
      n: activePatientsCount,
      of: activePatientsCount,
      pct: activePatientsCount > 0 ? 1 : 0,
    },
  ];

  const heroPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;
  const streak = pulse?.streak ?? 0;

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
  const freshEvent = activityItems[0] ?? null;
  const todayItems = activityItems.slice(1, 6);

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

        {/* Hero — shift rings */}
        <section
          className="relative overflow-hidden rounded-3xl p-4 text-white sm:p-5"
          style={{
            background: "linear-gradient(160deg, #0f1f11 0%, #17291d 100%)",
            boxShadow: "0 18px 36px -20px rgba(10,31,21,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
              {t.homePage.heroKicker}
            </span>
            {heroPct !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white/90">
                <span className="h-1 w-1 rounded-full bg-[#6ba888]" aria-hidden />
                {t.homePage.progressComplete(heroPct)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="-ms-2 shrink-0">
              <ShiftRings rings={rings} reduced={reduced} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {rings.map((r, i) => (
                <div key={r.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-white/80">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} aria-hidden />
                      {r.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-white/55">
                      <span className="font-semibold text-white">
                        <CountUp to={r.n} durationMs={900 + i * 150} reduced={reduced} />
                      </span>
                      {r.of > 0 && <span> / {r.of}</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(1, r.pct)) * 100}%`,
                        background: r.color,
                        transition: reduced ? undefined : "width 1100ms cubic-bezier(0.34,1.56,0.64,1)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Streak — celebrated only when there is one */}
        {streak > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-3">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold tabular-nums text-primary-foreground">
              {streak}
            </div>
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
                <Flame className="h-3 w-3" aria-hidden />
                {t.homePage.streakLabel(streak)}
              </p>
              <p className="mt-0.5 text-[13px] font-semibold text-ivory-text">
                {t.homePage.streakTitle}
              </p>
            </div>
          </div>
        )}

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

        {/* Quick actions — mobile relies on bottom-nav scan; desktop shows scan + alerts */}
        <section>
          {isDesktop && (
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ivory-text3">
              {t.homePage.orLabel}
            </p>
          )}
          <div className={cn("grid gap-2", isDesktop ? "grid-cols-2" : "grid-cols-1")}>
            {isDesktop && (
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
            )}

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

        {/* Fresh event — the most recent thing that happened */}
        {freshEvent && (
          <Link
            href={`/equipment/${freshEvent.equipmentId}`}
            className="flex items-center gap-3 rounded-2xl border border-ivory-border bg-ivory-surface px-3.5 py-2.5 shadow-sm transition-colors hover:border-primary/30"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                {t.homePage.latestLabel}
              </p>
              <p className="truncate text-[12.5px] text-ivory-text">{freshEvent.equipmentName}</p>
            </div>
            <span className="shrink-0 text-[10.5px] tabular-nums text-ivory-text3">
              {formatRelativeTime(freshEvent.timestamp)}
            </span>
          </Link>
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
            !freshEvent && (
              <div className="rounded-2xl border border-ivory-border bg-ivory-surface">
                <EmptyState
                  icon={Activity}
                  message={t.homePage.activityFeedEmpty}
                  subMessage={t.homePage.activityFeedEmptyHint}
                />
              </div>
            )
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
