import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Flame, Share2, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { LoadingSection } from "@/components/ui/loading-section";
import { api } from "@/lib/api";
import { t, formatDateByLocale } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { useDirection } from "@/hooks/useDirection";
import { getCurrentUserId } from "@/lib/auth-store";
import { toast } from "sonner";
import { safeClipboardWriteText } from "@/lib/safe-browser";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useEnterOnce } from "@/hooks/use-enter-once";
import { cn } from "@/lib/utils";
import { AssetCopilotPanel } from "@/components/equipment/AssetCopilotPanel";

export default function ShiftRecapPage() {
  const { name } = useAuth();
  const userId = getCurrentUserId();
  const direction = useDirection();
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const isDesktop = useIsDesktop();
  const enterOnce = useEnterOnce("shift-recap");
  const firstName = name?.split(" ")[0] || t.homePage.fallbackName;

  const { data: pulse, isLoading: pulseLoading } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
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

  const tasksDone = pulse?.tasksCompletedToday ?? 0;
  const tasksOpen =
    (taskDashboard?.counts.today ?? 0) + (taskDashboard?.counts.overdue ?? 0);
  const tasksTotal = tasksDone + tasksOpen;
  const scansToday = pulse?.scansToday ?? 0;
  const streak = pulse?.streak ?? 0;
  const heroPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;

  const shareText = useMemo(() => {
    const date = formatDateByLocale(new Date(), { weekday: "long", day: "numeric", month: "short" });
    const lines = [
      t.shiftRecap.shareHeadline(firstName, date),
      heroPct !== null ? t.shiftRecap.shareProgress(heroPct) : null,
      t.shiftRecap.shareTasks(tasksDone, tasksTotal),
      t.shiftRecap.shareScans(scansToday),
      streak > 0 ? t.shiftRecap.shareStreak(streak) : null,
      t.shiftRecap.shareFooter,
    ].filter(Boolean);
    return lines.join("\n");
  }, [firstName, heroPct, tasksDone, tasksTotal, scansToday, streak]);

  const handleShare = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: shareText, title: t.shiftRecap.shareTitle });
        return;
      }
      await safeClipboardWriteText(shareText);
      toast.success(t.shiftRecap.copySuccess);
    } catch {
      toast.error(t.shiftRecap.copyError);
    }
  };

  const loading = pulseLoading || tasksLoading;

  const content = (
    <>
      <Helmet>
        <title>{t.shiftRecap.pageTitle}</title>
      </Helmet>

      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-3 pb-nav-safe pt-2 sm:px-5">
        <header className="flex items-center gap-3 pt-2">
          <Link
            href="/home"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ivory-border bg-ivory-surface text-ivory-text2 shadow-sm"
            aria-label={t.shiftRecap.backHome}
          >
            <Chevron className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ivory-text3">{t.shiftRecap.kicker}</p>
            <h1 className="text-2xl font-bold tracking-tight text-ivory-text">{t.shiftRecap.title}</h1>
          </div>
        </header>

        {loading ? (
          <LoadingSection rows={5} />
        ) : (
          <>
            {streak > 0 && (
              <div
                className={cn(
                  "flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4",
                  enterOnce && "motion-safe:animate-[badgePop_0.6s_ease-out_both]",
                )}
                data-testid="shift-recap-streak"
              >
                <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-bold tabular-nums text-primary-foreground">
                  {streak}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
                    <Flame className="h-3.5 w-3.5" aria-hidden />
                    {t.homePage.streakLabel(streak)}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-ivory-text">{t.homePage.streakTitle}</p>
                </div>
              </div>
            )}

            <section
              className="overflow-hidden rounded-3xl border border-ivory-border bg-ivory-surface p-5 shadow-card"
              data-testid="shift-recap-card"
            >
              <div className="mb-4 flex items-center gap-2 text-primary">
                <ClipboardCheck className="h-5 w-5" aria-hidden />
                <span className="text-xs font-bold uppercase tracking-[0.14em]">{t.shiftRecap.cardLabel}</span>
              </div>
              <p className="text-lg font-bold text-ivory-text">{t.shiftRecap.cardGreeting(firstName)}</p>
              <p className="mt-1 text-sm text-ivory-text3">{t.shiftRecap.cardSubline}</p>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-muted/60 px-3 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-ivory-text whitespace-nowrap">
                    {heroPct !== null ? `${heroPct}%` : "—"}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ivory-text3">
                    {t.shiftRecap.statProgress}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-ivory-text whitespace-nowrap">
                    {tasksDone}
                    <span className="text-base font-semibold text-ivory-text3">/{tasksTotal || "—"}</span>
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ivory-text3">
                    {t.shiftRecap.statTasks}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-ivory-text whitespace-nowrap">{scansToday}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ivory-text3">
                    {t.shiftRecap.statScans}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                className="mt-5 h-14 w-full gap-2 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-deep)] text-base font-bold text-white"
                onClick={() => void handleShare()}
                data-testid="btn-share-shift-recap"
              >
                <Share2 className="h-5 w-5" aria-hidden />
                {t.shiftRecap.shareCta}
              </Button>
            </section>

            <AssetCopilotPanel />
          </>
        )}
      </div>
    </>
  );

  if (isDesktop) {
    return <PageShell>{content}</PageShell>;
  }

  return <Layout>{content}</Layout>;
}
