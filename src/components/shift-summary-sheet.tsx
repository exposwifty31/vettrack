import { t, formatDateTimeByLocale, formatDateByLocale } from "@/lib/i18n";
import { useEffect, useMemo, useRef } from "react";
import { toPng } from "html-to-image";
import { ShiftShareCard } from "@/components/ShiftShareCard";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { computeAlerts, cn } from "@/lib/utils";
import { buildAlertAckSet } from "@/lib/alert-counts";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  X,
  ClipboardCopy,
  FileText,
  PackageOpen,
  AlertTriangle,
  Wrench,
  CheckCircle2,
  MapPin,
  ClipboardCheck,
  ArrowUpRight,
  Flame,
  Share2,
} from "lucide-react";
import { useEnterOnce } from "@/hooks/use-enter-once";
import { format } from "date-fns";
import { toast } from "sonner";
import type { AlertAcknowledgment } from "@/types";
import { safeClipboardWriteText } from "@/lib/safe-browser";
import { isEquipmentRecoveryUiEnabled } from "@/lib/equipment-recovery-ui-flag";
import { derivePersonalEquipmentDebt } from "@/lib/equipment-personal-debt";
import { resolvePersonalDebtBannerKey } from "@/pages/my-equipment-personal-debt-labels";

interface ShiftSummarySheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShiftSummarySheet({ open, onClose }: ShiftSummarySheetProps) {
  const { email: userEmail, userId, name } = useAuth();
  const firstName = name?.split(" ")[0] || t.homePage.fallbackName;
  const enterOnce = useEnterOnce("shift-summary-sheet");
  const sheetRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  const { data: myItems, isLoading: myLoading, isError: myError, refetch: refetchMy } = useQuery({
    queryKey: ["/api/equipment/my"],
    queryFn: api.equipment.listMy,
    enabled: open && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: equipment, isLoading: eqLoading, isError: eqError, refetch: refetchEq } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: open && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: activityData, isLoading: actLoading, isError: actError, refetch: refetchAct } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: () => api.activity.feed(),
    enabled: open && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: acks, refetch: refetchAcks } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: open && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: pulse } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: open && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: taskDashboard } = useQuery({
    queryKey: ["/api/tasks/dashboard", userId ?? ""],
    queryFn: () => api.tasks.dashboard(),
    enabled: open && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const tasksDone = pulse?.tasksCompletedToday ?? 0;
  const tasksOpen = (taskDashboard?.counts.today ?? 0) + (taskDashboard?.counts.overdue ?? 0);
  const tasksTotal = tasksDone + tasksOpen;
  const scansToday = pulse?.scansToday ?? 0;
  const streak = pulse?.streak ?? 0;
  const heroPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;

  const shareText = useMemo(() => {
    const date = formatDateByLocale(new Date(), { weekday: "long", day: "numeric", month: "short" });
    const lines: (string | null)[] = [
      t.shiftRecap.shareHeadline(firstName, date),
      heroPct !== null ? t.shiftRecap.shareProgress(heroPct) : null,
      t.shiftRecap.shareTasks(tasksDone, tasksTotal),
      t.shiftRecap.shareScans(scansToday),
      streak > 0 ? t.shiftRecap.shareStreak(streak) : null,
      t.shiftRecap.shareFooter,
    ];
    return lines.filter(Boolean).join("\n");
  }, [firstName, heroPct, tasksDone, tasksTotal, scansToday, streak]);

  const handleShare = async () => {
    // Try PNG card share first (iOS native share sheet with image)
    if (cardRef.current && typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
      try {
        const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], "vettrack-shift.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: t.shiftRecap.shareTitle });
          return;
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        // Fall through to text share
      }
    }
    // Text fallback
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

  const isLoading = myLoading || eqLoading || actLoading;
  const isError = myError || eqError || actError;

  function retryAll() {
    refetchMy();
    refetchEq();
    refetchAct();
    refetchAcks();
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayCheckouts = activityData?.items.filter(
    (item) =>
      item.type === "scan" &&
      item.note != null &&
      (item.note?.includes("Checked out") || item.note?.includes("checked out")) &&
      item.userEmail === userEmail &&
      new Date(item.timestamp) >= todayStart
  ) ?? [];

  const todayIssues = activityData?.items.filter(
    (item) =>
      item.type === "scan" &&
      item.status === "issue" &&
      item.userEmail === userEmail &&
      new Date(item.timestamp) >= todayStart
  ) ?? [];

  const allAlerts = equipment ? computeAlerts(equipment) : [];
  const acksSet = buildAlertAckSet(acks as AlertAcknowledgment[] | undefined);
  const urgentAlerts = allAlerts.filter(
    (a) =>
      (a.severity === "critical" || a.severity === "high") &&
      !acksSet.has(`${a.equipmentId}:${a.type}`),
  );

  const personalDebt = useMemo(() => {
    if (!isEquipmentRecoveryUiEnabled || !myItems?.length) return null;
    return derivePersonalEquipmentDebt(myItems);
  }, [myItems]);

  const personalDebtCompactSummary = useMemo(() => {
    if (!personalDebt || personalDebt.attentionCount === 0) return null;
    const bannerKey = resolvePersonalDebtBannerKey(personalDebt);
    if (!bannerKey) return null;
    return t.myEquipmentPage[bannerKey].replace(
      "{count}",
      String(personalDebt.attentionCount),
    );
  }, [personalDebt]);

  function buildSummaryText(): string {
    const dateStr = format(new Date(), "MMMM d, yyyy");
    const lines: string[] = [t.shiftSummaryPage.reportHeader(dateStr), ""];

    lines.push(t.shiftSummary.sections.checkedOut);
    if (myItems && myItems.length > 0) {
      for (const item of myItems) {
        const loc = item.checkedOutLocation || item.location;
        const since = item.checkedOutAt
          ? formatRelativeTime(item.checkedOutAt)
          : t.shiftSummaryPage.unknownLocation;
        lines.push(t.shiftSummaryPage.checkedOutLine(item.name, loc || "", since));
      }
    } else {
      lines.push(t.shiftSummaryPage.listBulletNone);
    }

    lines.push("");

    if (todayCheckouts.length > 0) {
      lines.push(t.shiftSummaryPage.todayUsageHeader(todayCheckouts.length));
      for (const item of todayCheckouts) {
        lines.push(`• ${item.equipmentName} — ${formatRelativeTime(item.timestamp)}`);
      }
      lines.push("");
    }

    lines.push(t.shiftSummary.sections.issuesReported);
    if (todayIssues.length > 0) {
      for (const item of todayIssues) {
        lines.push(`• ${item.equipmentName}`);
      }
    } else {
      lines.push(t.shiftSummaryPage.listBulletNone);
    }

    lines.push("");

    lines.push(t.shiftSummary.sections.unacknowledgedAlerts);
    if (urgentAlerts.length > 0) {
      for (const alert of urgentAlerts) {
        const tag = alert.severity === "critical" ? t.shiftSummary.severity.critical : t.shiftSummary.severity.high;
        lines.push(`• ${tag} ${alert.equipmentName} — ${alert.detail}`);
      }
    } else {
      lines.push(t.shiftSummaryPage.listBulletNone);
    }

    return lines.join("\n");
  }

  async function handleCopy() {
    const text = buildSummaryText();
    const ok = await safeClipboardWriteText(text);
    if (ok) {
      toast.success(t.shiftSummary.toast.copySuccess);
    } else {
      toast.error(t.shiftSummary.toast.copyError);
    }
  }

  async function handleDownloadPdf() {
    let jsPDF: typeof import("jspdf")["jsPDF"];
    try {
      ({ jsPDF } = await import("jspdf"));
    } catch (importErr) {
      console.error("Failed to load jsPDF module", importErr);
      toast.error(t.common.toast.unexpectedError);
      return;
    }
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const margin = 14;
    const pageHeight = 297;
    let y = 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("VetTrack Shift Summary", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${formatDateTimeByLocale(new Date())}`, margin, y);
    y += 8;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, 196, y);
    y += 8;

    const lines = buildSummaryText().split("\n");
    doc.setFontSize(10);

    for (const line of lines) {
      if (y > pageHeight - 14) {
        doc.addPage();
        y = 20;
      }

      const safeLine = line.replace(/^•\s?/, "- ");
      const wrapped = doc.splitTextToSize(safeLine || " ", 182);
      for (const wrappedLine of wrapped) {
        if (y > pageHeight - 14) {
          doc.addPage();
          y = 20;
        }
        doc.text(wrappedLine, margin, y);
        y += 6;
      }
    }

    const filename = `vettrack-shift-summary-${format(new Date(), "yyyy-MM-dd")}.pdf`;

    // On iOS WebView, doc.save() never triggers a file download.
    // Use the native share sheet with a File blob when supported.
    if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
      try {
        const blob = doc.output("blob");
        const file = new File([blob], filename, { type: "application/pdf" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "VetTrack Shift Summary" });
          toast.success(t.shiftSummaryPage.reportDownloaded);
          return;
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        // canShare/share threw unexpectedly — fall through to doc.save()
      }
    }

    doc.save(filename);
    toast.success(t.shiftSummaryPage.reportDownloaded);
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[65]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.shiftSummary.sections.checkedOut}
        className="fixed inset-x-0 bottom-0 z-[66] flex flex-col bg-white rounded-t-2xl shadow-2xl max-h-[88vh]"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-bold text-base leading-tight">{t.shiftSummaryPage.summaryTitle}</h2>
              <p className="text-xs text-muted-foreground">{format(new Date(), "EEEE, MMMM d")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-5">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-6 w-32 mt-2" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <AlertTriangle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-destructive font-medium text-center">{t.shiftSummaryPage.loadFailed}</p>
              <Button variant="outline" size="sm" onClick={retryAll}>
                {t.shiftSummaryPage.retry}
              </Button>
            </div>
          ) : (
            <>
              {/* Streak + today stats */}
              {streak > 0 && (
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4",
                    enterOnce && "motion-safe:animate-[badgePop_0.6s_ease-out_both]",
                  )}
                  data-testid="shift-summary-streak"
                >
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-bold tabular-nums text-primary-foreground">
                    {streak}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
                      <Flame className="h-3.5 w-3.5" aria-hidden />
                      {t.homePage.streakLabel(streak)}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold">{t.homePage.streakTitle}</p>
                  </div>
                </div>
              )}

              {/* 3-stat grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-muted/60 px-3 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums whitespace-nowrap">
                    {heroPct !== null ? `${heroPct}%` : "—"}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.shiftRecap.statProgress}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums whitespace-nowrap">
                    {tasksDone}
                    <span className="text-base font-semibold text-muted-foreground">/{tasksTotal || "—"}</span>
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.shiftRecap.statTasks}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums whitespace-nowrap">{scansToday}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.shiftRecap.statScans}
                  </p>
                </div>
              </div>

              {/* Currently checked out */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <PackageOpen className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">{t.shiftSummaryPage.checkedOutNow}</h3>
                  <Badge variant="secondary" className="ms-auto">
                    {myItems?.length ?? 0}
                  </Badge>
                </div>
                {isEquipmentRecoveryUiEnabled && personalDebtCompactSummary && (
                  <p className="text-xs text-amber-700 mb-2">
                    {t.shiftSummaryPage.personalDebtCompactLine.replace(
                      "{summary}",
                      personalDebtCompactSummary,
                    )}
                  </p>
                )}
                {myItems && myItems.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {myItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.shiftSummaryPage.since} {formatRelativeTime(item.checkedOutAt)}
                          </p>
                        </div>
                        {(item.checkedOutLocation || item.location) && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                            <MapPin className="w-3 h-3" />
                            {item.checkedOutLocation || item.location}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-dashed">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <p className="text-sm text-muted-foreground">{t.shiftSummaryPage.noneInUse}</p>
                  </div>
                )}
              </div>

              {/* Today's checkout events */}
              {todayCheckouts.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <ArrowUpRight className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">{t.shiftSummaryPage.checkoutsToday}</h3>
                    <Badge variant="secondary" className="ms-auto">
                      {todayCheckouts.length}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {todayCheckouts.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20"
                      >
                        <p className="font-medium text-sm truncate">{item.equipmentName}</p>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {formatRelativeTime(item.timestamp)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Issues flagged today */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Wrench className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">{t.shiftSummaryPage.issuesReportedToday}</h3>
                  <Badge variant={todayIssues.length > 0 ? "maintenance" : "secondary"} className="ms-auto">
                    {todayIssues.length}
                  </Badge>
                </div>
                {todayIssues.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {todayIssues.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl bg-amber-50 border border-amber-200"
                      >
                        <p className="font-medium text-sm">{item.equipmentName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelativeTime(item.timestamp)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-dashed">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <p className="text-sm text-muted-foreground">{t.shiftSummaryPage.noIssuesToday}</p>
                  </div>
                )}
              </div>

              {/* Unacknowledged critical/high alerts */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-semibold">{t.shiftSummaryPage.unacknowledgedAlerts}</h3>
                  <Badge variant={urgentAlerts.length > 0 ? "issue" : "secondary"} className="ms-auto">
                    {urgentAlerts.length}
                  </Badge>
                </div>
                {urgentAlerts.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {urgentAlerts.map((alert) => (
                      <div
                        key={`${alert.type}-${alert.equipmentId}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-red-50 border border-red-200"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{alert.equipmentName}</p>
                          <p className="text-xs text-muted-foreground">{alert.detail}</p>
                        </div>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0 ${
                            alert.severity === "critical" ? "bg-red-600" : "bg-amber-500"
                          }`}
                        >
                          {alert.severity === "critical" ? t.shiftSummary.badge.critical : t.shiftSummary.badge.high}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-dashed">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <p className="text-sm text-muted-foreground">{t.shiftSummaryPage.noCriticalAlerts}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pt-4 pb-safe border-t bg-white flex gap-2">
          <Button
            className="flex-1 gap-2"
            variant="outline"
            onClick={handleCopy}
            disabled={isLoading}
            data-testid="btn-copy-shift-summary"
          >
            <ClipboardCopy className="w-4 h-4" />
            {t.shiftSummary.actions.copy}
          </Button>
          <Button
            className="flex-1 gap-2"
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={isLoading}
            data-testid="btn-download-shift-summary-pdf"
          >
            <FileText className="w-4 h-4" />
            {t.shiftSummaryPage.downloadPdf}
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={() => void handleShare()}
            disabled={isLoading}
            data-testid="btn-share-shift-summary"
          >
            <Share2 className="w-4 h-4" />
            {t.shiftRecap.shareCta}
          </Button>
        </div>
      </div>
      {/* Off-screen capture target for PNG share */}
      <ShiftShareCard
        ref={cardRef}
        data={{
          name: firstName,
          date: formatDateByLocale(new Date(), { weekday: "long", day: "numeric", month: "short" }),
          tasksDone,
          tasksTotal,
          scansToday,
          streak,
          heroPct,
        }}
      />
    </>
  );
}
