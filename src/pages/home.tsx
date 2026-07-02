
import { Bdi } from "@/components/ui/bdi";
import { t, formatDateByLocale, getStoredLocale } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingSection } from "@/components/ui/loading-section";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countCriticalAlerts } from "@/lib/alert-counts";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useAuth } from "@/hooks/use-auth";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { QrScanner } from "@/components/qr-scanner";
import { useScanAffordance } from "@/lib/scan-affordance";
import { ShiftAdjustmentControls } from "@/features/shift-adjustments/ShiftAdjustmentControls";
import { getCurrentUserId } from "@/lib/auth-store";
import { subscribeKeepalive } from "@/lib/realtime";
import type { ActivityFeedItem } from "@/types";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Clock,
  Plus,
  ScanLine,
  Siren,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterOnce } from "@/hooks/use-enter-once";

/** Locale-aware "6:30 AM" / "6:30" clock — toLocaleDateString drops time parts. */
function formatClock(value: Date | string): string {
  const localeTag = getStoredLocale() === "he" ? "he-IL" : "en-US";
  return new Date(value).toLocaleTimeString(localeTag, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Elapsed shift time as `HH:MM`, degrading to `Nd HH:MM` past 24h so a
 * long-open (or stale) shift never overflows the hero timer.
 */
function formatElapsed(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const hh = String(Math.floor((m % 1440) / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const days = Math.floor(m / 1440);
  return days > 0 ? `${t.homePage.elapsedDays(days)} ${hh}:${mm}` : `${hh}:${mm}`;
}

/** Time-of-day greeting including the user's first name. */
function greetingFor(hour: number, name: string): string {
  if (hour < 12) return t.homePage.greetingMorning(name);
  if (hour < 18) return t.homePage.greetingAfternoon(name);
  return t.homePage.greetingEvening(name);
}

type ActivityStyle = {
  bg: string;
  fg: string;
  Icon: typeof ScanLine;
  label: () => string;
};

/** Map an activity-feed row onto its Stage-3 tinted glyph + action verb. */
function activityStyle(item: ActivityFeedItem): ActivityStyle {
  switch (item.type) {
    case "transfer":
      return {
        bg: "rgb(var(--sys-blue) / 0.12)",
        fg: "rgb(var(--sys-blue))",
        Icon: ArrowLeftRight,
        label: () => t.homePage.activityMoved,
      };
    case "created":
      return {
        bg: "rgb(var(--sys-green) / 0.12)",
        fg: "rgb(var(--sys-green))",
        Icon: Plus,
        label: () => t.homePage.activityAdded,
      };
    case "scan":
    default:
      return {
        bg: "rgb(var(--sys-green) / 0.12)",
        fg: "rgb(var(--sys-green))",
        Icon: ScanLine,
        label: () => t.homePage.activityScanned,
      };
  }
}

export default function HomePage() {
  const { name, refreshAuth } = useAuth();
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activeCodeBlueId, setActiveCodeBlueId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const searchStr = useSearch();
  const enterOnce = useEnterOnce("home");
  const rise = enterOnce ? "vt-pro-rise" : "";
  const isDesktop = useIsDesktop();
  const scanAffordance = useScanAffordance();

  useRealtimeReconciliation({ queryClient });

  useEffect(
    () =>
      subscribeKeepalive(({ activeCodeBlueSessionId }) => {
        setActiveCodeBlueId(activeCodeBlueSessionId);
      }),
    [],
  );

  // Tick the elapsed timer at minute granularity.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Display-only connectivity cue. Emergency mutations are never queued here —
  // this only surfaces a "data may be outdated" banner (frozen-surface safe).
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && !navigator.onLine,
  );
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    // No scan surface on web (BUG-016) — ignore the ?scan=1 deep-link there.
    if (scanAffordance === "none") return;
    const params = new URLSearchParams(searchStr);
    if (params.get("scan") === "1") setScannerOpen(true);
  }, [searchStr, scanAffordance]);

  const {
    data: equipment,
    isError: equipmentError,
    isLoading: equipmentLoading,
    refetch,
  } = useQuery({
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

  const { data: taskDashboard } = useQuery({
    queryKey: ["/api/tasks/dashboard", userId ?? ""],
    queryFn: () => api.tasks.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: pulse, isLoading: pulseLoading } = useQuery({
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

  // ---- derived shift + criticality figures ----
  const alerts = equipment ? computeAlerts(equipment) : [];
  const criticalCount = countCriticalAlerts(alerts, buildAlertAckSet(alertAcks));
  const overdueCount = taskDashboard?.counts.overdue ?? 0;
  const totalCount = equipment?.length ?? 0;
  const itemsOut = equipment
    ? equipment.filter((e) => e.custodyState === "checked_out").length
    : 0;
  const scansDone = pulse?.scansToday ?? 0;

  const firstName = name?.split(" ")[0] || t.homePage.fallbackName;
  const greeting = greetingFor(new Date().getHours(), firstName);
  const dateLine = formatDateByLocale(new Date(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // On-shift is roster-derived server-side: `pulse.shift` is populated only when
  // the caller is inside a scheduled vt_shifts window. A roster window is
  // self-bounding, so no client-side staleness guard is needed.
  const hasActiveShift = !!pulse?.shift;

  const heroState: "loading" | "noshift" | "active" =
    pulseLoading && !pulse ? "loading" : hasActiveShift ? "active" : "noshift";

  let elapsed = "00:00";
  let startedLabel = "";
  if (pulse?.shift) {
    const shiftMins = Math.max(
      0,
      Math.round((now - new Date(pulse.shift.startedAt).getTime()) / 60_000),
    );
    elapsed = formatElapsed(shiftMins);
    startedLabel = t.homePage.startedAt(formatClock(pulse.shift.startedAt));
  }

  const showChips = heroState === "active";
  // BUG-005 / BUG-016: the Today scan card is redundant wherever a persistent
  // scan affordance exists (the flat scan tab on iPhone) and is disallowed on
  // web entirely. It survives only on iPad, where the platform gate resolves to
  // "fab" — the one place a prominent Today scan CTA is not a duplicate.
  const showScanCard = heroState !== "loading" && scanAffordance === "fab";
  const showScanSkeleton = heroState === "loading" && scanAffordance === "fab";
  const showRecent = isDesktop && heroState === "active";
  const recentItems = (activityData?.items ?? []).slice(0, 4);

  const pageContent = (
    <>
      <Helmet>
        <title>Dashboard — VetTrack</title>
        <meta
          name="description"
          content="Real-time veterinary equipment dashboard. Track your shift at a glance, scan equipment, and triage critical and overdue items across your clinic."
        />
        <link rel="canonical" href="https://vettrack.replit.app/" />
      </Helmet>

      <div className="vt-enter-stagger mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pb-nav-safe pt-3 sm:gap-6 sm:px-6 lg:max-w-[1120px]">
        {/* Greeting — large-title glance */}
        <header className={rise}>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] text-ivory-text">
            <Bdi>{greeting}</Bdi>
          </h1>
          <p className="mt-1.5 text-[15px] font-medium text-ivory-text3">
            {dateLine}
          </p>
        </header>

        {/* Offline — display-only cue; data may be stale until reconnect */}
        {isOffline && (
          <div
            role="alert"
            className="rounded-xl px-3.5 py-2.5 text-sm font-semibold"
            style={{
              background: "rgb(var(--offline-bg))",
              border: "1px solid rgb(var(--offline-border))",
              color: "rgb(var(--offline-text))",
            }}
          >
            {t.home.offline}
          </div>
        )}

        {/* Code Blue active — rare, safety-critical, kept above the fold */}
        {activeCodeBlueId && (
          <Link
            href="/code-blue"
            className="flex items-center gap-3 rounded-[14px] border px-4 py-3 shadow-card transition-transform motion-safe:active:scale-[0.99]"
            style={{
              borderColor: "rgb(var(--sys-red) / 0.3)",
              background: "rgb(var(--sys-red) / 0.12)",
            }}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white"
              style={{ background: "rgb(var(--sys-red))" }}
            >
              <Siren className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block text-sm font-bold"
                style={{ color: "rgb(var(--sys-red))" }}
              >
                {t.homePage.urgentCodeBlue}
              </span>
              <span className="block text-xs text-ivory-text3">
                {t.homePage.urgentCodeBlueHint}
              </span>
            </span>
            <ForwardChevron
              className="h-4 w-4 shrink-0 opacity-70"
              style={{ color: "rgb(var(--sys-red))" }}
              aria-hidden
            />
          </Link>
        )}

        {/* Equipment-load failure replaces the content region (Code Blue banner
            above stays visible — it is keepalive-driven, not equipment-driven). */}
        {equipmentError ? (
          <ErrorCard
            message={t.equipmentList.errors.loadFailed}
            onRetry={() => {
              queryClient.clear();
              refreshAuth();
              refetch();
            }}
          />
        ) : (
          <>
        {/* Content grid — hero left, criticality + scan + recent right (desktop) */}
        <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(320px,360px)_1fr]">
          {/* ON-SHIFT hero */}
          <section
            className={cn(
              "relative w-full overflow-hidden rounded-[20px] p-[18px] shadow-hero",
              rise,
            )}
            style={{
              background:
                "radial-gradient(130% 90% at 0% 0%, var(--ink-sheen), transparent 60%), var(--brand-ink)",
              color: "var(--on-ink)",
            }}
            aria-label={t.homePage.onShift}
          >
            {heroState === "loading" ? (
              <div className="space-y-4">
                <div className="h-3 w-24 rounded-md bg-white/15" />
                <div className="h-9 w-36 rounded-lg bg-white/15" />
                <div className="h-2.5 w-16 rounded bg-white/15" />
                <div className="flex gap-7 pt-2">
                  <div className="h-8 w-16 rounded-md bg-white/15" />
                  <div className="h-8 w-16 rounded-md bg-white/15" />
                </div>
                <div className="h-12 w-full rounded-[14px] bg-white/15" />
              </div>
            ) : heroState === "noshift" ? (
              <div className="flex flex-col items-start gap-2.5 py-2">
                <span
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
                  style={{ background: "var(--ink-divider)" }}
                >
                  <Clock className="h-6 w-6" aria-hidden />
                </span>
                <p className="mt-1.5 text-[20px] font-bold">
                  {t.home.shift.noShift}
                </p>
                <p
                  className="max-w-[38ch] text-sm leading-relaxed"
                  style={{ color: "var(--on-ink-strong)" }}
                >
                  {t.homePage.noShiftSub}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2.5">
                  <span
                    className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: "var(--on-ink-strong)" }}
                  >
                    <span className="relative inline-flex h-2.5 w-2.5">
                      <span
                        className="absolute inset-0 rounded-full"
                        style={{ background: "rgb(var(--sys-green))" }}
                      />
                      <span
                        className="absolute inset-0 rounded-full motion-safe:animate-ping"
                        style={{ background: "rgb(var(--sys-green))" }}
                      />
                    </span>
                    {t.homePage.onShift}
                  </span>
                  <span
                    className="font-num text-xs"
                    style={{ color: "var(--on-ink-muted)" }}
                  >
                    {startedLabel}
                  </span>
                </div>

                <p
                  dir="ltr"
                  className="mt-3 font-num text-[2.353rem] font-medium leading-none tracking-[-0.01em] tabular-nums rtl:text-end"
                >
                  {elapsed}
                </p>
                <p
                  className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: "var(--on-ink-muted)" }}
                >
                  {t.homePage.elapsedLabel}
                </p>

                <div className="mt-5 flex items-stretch">
                  <div className="flex-1">
                    <p className="font-num text-[1.294rem] font-medium leading-none tabular-nums">
                      {itemsOut}
                    </p>
                    <p
                      className="mt-1 text-[11px] font-medium uppercase tracking-[0.04em]"
                      style={{ color: "var(--on-ink-muted)" }}
                    >
                      {t.home.shift.itemsOut}
                    </p>
                  </div>
                  <div
                    className="mx-[18px] w-px self-stretch"
                    style={{ background: "var(--ink-divider)" }}
                    aria-hidden
                  />
                  <div className="flex-1">
                    <p className="font-num text-[1.294rem] font-medium leading-none tabular-nums">
                      {scansDone}
                    </p>
                    <p
                      className="mt-1 text-[11px] font-medium uppercase tracking-[0.04em]"
                      style={{ color: "var(--on-ink-muted)" }}
                    >
                      {t.home.shift.scansToday}
                    </p>
                  </div>
                </div>

                {pulse?.shift && (
                  <ShiftAdjustmentControls endsAt={pulse.shift.endsAt} />
                )}
              </>
            )}
          </section>

          {/* Right column */}
          <div className="flex flex-col gap-5 sm:gap-6">
            {showChips && (
              <div className="grid grid-cols-2 gap-2.5">
                <Link
                  href="/alerts"
                  aria-label={`${criticalCount} ${t.homePage.criticalLabel}`}
                  data-testid="chip-critical"
                  className="flex min-h-[60px] items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-transform motion-safe:active:scale-[0.99]"
                  style={{
                    borderColor: "rgb(var(--sys-red) / 0.22)",
                    background: "rgb(var(--sys-red) / 0.12)",
                  }}
                >
                  <span
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white"
                    style={{ background: "rgb(var(--sys-red))" }}
                  >
                    <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="flex flex-col items-start leading-tight">
                    <span
                      className="font-num text-[20px] font-bold tabular-nums"
                      style={{ color: "rgb(var(--sys-red))" }}
                    >
                      {criticalCount}
                    </span>
                    <span
                      className="text-[11px] font-semibold uppercase tracking-[0.04em]"
                      style={{ color: "rgb(var(--sys-red) / 0.78)" }}
                    >
                      {t.homePage.criticalLabel}
                    </span>
                  </span>
                  <ForwardChevron
                    className="ms-auto h-[18px] w-[18px] opacity-45"
                    style={{ color: "rgb(var(--sys-red))" }}
                    aria-hidden
                  />
                </Link>

                <Link
                  href="/equipment/tasks"
                  aria-label={`${overdueCount} ${t.homePage.overdueLabel}`}
                  data-testid="chip-overdue"
                  className="flex min-h-[60px] items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-transform motion-safe:active:scale-[0.99]"
                  style={{
                    borderColor: "rgb(var(--sys-orange) / 0.22)",
                    background: "rgb(var(--sys-orange) / 0.12)",
                  }}
                >
                  <span
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white"
                    style={{ background: "rgb(var(--sys-orange))" }}
                  >
                    <Clock className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="flex flex-col items-start leading-tight">
                    <span
                      className="font-num text-[20px] font-bold tabular-nums"
                      style={{ color: "rgb(var(--sys-orange))" }}
                    >
                      {overdueCount}
                    </span>
                    <span
                      className="text-[11px] font-semibold uppercase tracking-[0.04em]"
                      style={{ color: "rgb(var(--sys-orange) / 0.78)" }}
                    >
                      {t.homePage.overdueLabel}
                    </span>
                  </span>
                  <ForwardChevron
                    className="ms-auto h-[18px] w-[18px] opacity-45"
                    style={{ color: "rgb(var(--sys-orange))" }}
                    aria-hidden
                  />
                </Link>
              </div>
            )}

            {showScanSkeleton && (
              <Skeleton className="h-[60px] w-full rounded-[16px]" />
            )}

            {showScanCard && (
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                data-testid="quick-action-scan"
                className="flex min-h-[60px] w-full items-center gap-3.5 rounded-[16px] px-4 py-3.5 text-start transition-transform motion-safe:active:scale-[0.99]"
                style={{ background: "var(--action)", color: "var(--action-foreground)" }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-bold">
                    {t.homePage.scanEquipment}
                  </span>
                  <span
                    className="text-[13px] font-medium"
                    style={{
                      color:
                        "color-mix(in srgb, var(--action-foreground) 78%, transparent)",
                    }}
                  >
                    {t.homePage.scanEquipmentSub}
                  </span>
                </span>
                <span
                  className="ms-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                  style={{
                    background:
                      "color-mix(in srgb, var(--action-foreground) 16%, transparent)",
                  }}
                >
                  <ScanLine className="h-[22px] w-[22px]" aria-hidden />
                </span>
              </button>
            )}

            {showRecent && (
              <section className="overflow-hidden rounded-[16px] border border-ivory-border bg-ivory-surface pb-1">
                <div className="flex items-center justify-between px-[18px] pb-2 pt-3">
                  <p className="text-[16px] font-semibold text-ivory-text">
                    {t.homePage.recentActivity}
                  </p>
                  <Link
                    href="/audit-log"
                    className="text-[13px] font-semibold text-brand"
                  >
                    {t.homePage.viewAll}
                  </Link>
                </div>
                {activityLoading ? (
                  <div className="px-[18px] pb-3">
                    <LoadingSection rows={4} />
                  </div>
                ) : recentItems.length > 0 ? (
                  recentItems.map((item) => {
                    const s = activityStyle(item);
                    const Icon = s.Icon;
                    return (
                      <Link
                        key={item.id}
                        href={`/equipment/${item.equipmentId}`}
                        className="flex items-center gap-3 border-t border-ivory-border px-[18px] py-2.5 transition-colors hover:bg-muted/40"
                      >
                        <span
                          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
                          style={{ background: s.bg, color: s.fg }}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-ivory-text">
                            {s.label()}{" · "}
                            <span className="font-normal text-ivory-text3">
                              {item.equipmentName}
                            </span>
                          </p>
                          <p className="mt-0.5 truncate text-[12px] font-medium text-ivory-text3">
                            {item.userId === userId
                              ? t.homePage.activityYou
                              : item.userEmail?.split("@")[0] ?? ""}
                          </p>
                        </div>
                        <span className="shrink-0 font-num text-[12px] tabular-nums text-ivory-text3">
                          {formatClock(item.timestamp)}
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <EmptyState
                    icon={Activity}
                    message={t.homePage.activityFeedEmpty}
                    subMessage={t.homePage.activityFeedEmptyHint}
                  />
                )}
              </section>
            )}
          </div>
        </div>

        {/* Get started — brand-new clinic with no equipment yet */}
        {!equipmentLoading && totalCount === 0 && (
          <div className="rounded-2xl border border-ivory-border bg-ivory-surface p-5 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Plus className="h-6 w-6 text-foreground/70" aria-hidden />
            </div>
            <h3 className="mb-1 text-[1.176rem] font-bold text-ivory-text">
              {t.homePage.getStarted}
            </h3>
            <p className="mb-4 text-sm text-ivory-text3">
              {t.homePage.getStartedDescription}
            </p>
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
          </>
        )}
      </div>

      {scannerOpen && <QrScanner onClose={() => setScannerOpen(false)} />}
    </>
  );

  return <AppShell>{pageContent}</AppShell>;
}
