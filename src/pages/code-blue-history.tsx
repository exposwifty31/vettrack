// src/pages/code-blue-history.tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useDirection } from "@/hooks/useDirection";
import type { CodeBlueSession } from "@/hooks/useCodeBlueSession";
import { t, formatDateTimeByLocale } from "@/lib/i18n";

const OUTCOME_COLORS: Record<string, string> = {
  rosc: "text-[var(--status-ok-fg)]",
  died: "text-[var(--status-issue-fg)]",
  transferred: "text-[rgb(var(--sys-blue))]",
  ongoing: "text-[var(--status-stale-fg)]",
};

export default function CodeBlueHistoryPage() {
  const { userId, role, effectiveRole } = useAuth();
  const dir = useDirection();
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [, navigate] = useLocation();
  const resolvedRole = effectiveRole ?? role;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Recomputed every render so a runtime locale switch
  // (`setStoredLocale` → `refreshTranslations`) is reflected here.
  // Initial PR captured `t` at module load, which froze these labels
  // to the locale active at first import (Cursor Bugbot + Codex
  // finding on PR #338).
  const OUTCOME_LABELS: Record<string, string> = {
    rosc: "ROSC",
    died: t.codeBlue.history.outcomeLabels.died,
    transferred: t.codeBlue.history.outcomeLabels.transferred,
    ongoing: t.codeBlue.history.outcomeLabels.ongoing,
  };

  const historyQ = useQuery<CodeBlueSession[]>({
    queryKey: ["/api/code-blue/history"],
    queryFn: () => api.codeBlue.history(),
    enabled: !!userId && (resolvedRole === "admin"),
  });

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate("/home");
  };

  const backButton = (
    <button
      type="button"
      onClick={handleBack}
      aria-label={t.common.back}
      data-testid="code-blue-history-back"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted motion-safe:active:scale-95"
    >
      <BackIcon className="h-5 w-5" aria-hidden />
    </button>
  );

  if (resolvedRole !== "admin") {
    return (
      <div className="flex h-screen-safe flex-col items-center justify-center gap-4 bg-background p-8 text-center text-muted-foreground" dir={dir}>
        <p>{t.codeBlue.history.adminOnly}</p>
        <button
          type="button"
          onClick={handleBack}
          className="rounded-full border border-border bg-muted px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          {t.common.back}
        </button>
      </div>
    );
  }

  const sessions = historyQ.data ?? [];

  return (
    <div className="flex flex-col h-screen-safe bg-background max-w-4xl mx-auto overflow-hidden" dir={dir}>
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border">
        {backButton}
        <Clock className="h-5 w-5 text-[var(--status-issue-fg)]" />
        <h1 className="text-xl font-bold">{t.codeBlue.history.title}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
      {historyQ.isPending && <p className="text-muted-foreground">{t.codeBlue.history.loading}</p>}

      {historyQ.isError && (
        <p className="text-[var(--status-issue-fg)] text-sm">{t.codeBlue.history.loadFailed}</p>
      )}

      {sessions.length === 0 && !historyQ.isPending && (
        <p className="text-muted-foreground">{t.codeBlue.history.empty}</p>
      )}

      <div className="flex flex-col gap-3">
        {sessions.map((s) => {
          const expanded = expandedId === s.id;
          const duration = s.endedAt
            ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)
            : null;

          return (
            <div key={s.id} className="rounded-lg border border-border bg-card overflow-hidden">
              <button
                type="button"
                className="w-full p-4 flex items-center gap-4 text-end hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedId(expanded ? null : s.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-white">
                      {new Date(s.startedAt).toLocaleString("he-IL", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {s.outcome && (
                      <span className={`text-sm font-bold ${OUTCOME_COLORS[s.outcome] ?? "text-muted-foreground"}`}>
                        {OUTCOME_LABELS[s.outcome] ?? s.outcome}
                      </span>
                    )}
                    {duration !== null && (
                      <span className="text-xs text-muted-foreground">{t.codeBlue.history.minutesShort(duration)}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.codeBlue.history.managerOpenedBy(s.managerUserName, s.startedByName)}
                  </div>
                </div>
                {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {expanded && (
                <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <span className="text-muted-foreground">{t.codeBlue.history.eventStart}</span>
                    <span>{formatDateTimeByLocale(s.startedAt, { timeStyle: "medium" })}</span>
                    {s.endedAt && (
                      <>
                        <span className="text-muted-foreground">{t.codeBlue.history.eventEnd}</span>
                        <span>{formatDateTimeByLocale(s.endedAt, { timeStyle: "medium" })}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">{t.codeBlue.history.cartCheck}</span>
                    <span>{s.preCheckPassed === true ? t.codeBlue.history.checkStatus.passed : s.preCheckPassed === false ? t.codeBlue.history.checkStatus.failed : t.codeBlue.history.checkStatus.notPerformed}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
