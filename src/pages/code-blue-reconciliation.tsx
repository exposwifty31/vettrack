import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { ShieldAlert, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Receipt } from "lucide-react";
import { Link } from "wouter";
import type { CodeBlueReconciliationSession, CodeBlueDispense } from "@/types";

function formatCents(cents: number): string {
  return `₪${(cents / 100).toFixed(2)}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionRow({ session }: { session: CodeBlueReconciliationSession }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const dispensesQ = useQuery({
    queryKey: ["/api/code-blue/sessions", session.sessionId, "dispenses"],
    queryFn: () => api.codeBlue.sessionDispenses(session.sessionId).then((r) => r.dispenses),
    enabled: expanded,
    retry: false,
    staleTime: 30_000,
  });

  const reconcileMut = useMutation({
    mutationFn: () => api.codeBlue.reconcile(session.sessionId),
    onSuccess: () => {
      toast.success("ההפעלה סומנה כגושרת");
      qc.invalidateQueries({ queryKey: ["/api/code-blue/reconciliation"] });
    },
    onError: () => toast.error("סימון כגשור נכשל"),
  });

  const unbilledCount = session.dispenseCount - session.billedCount;
  const isReconciled = session.isReconciled;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">
              {session.patientName ?? "מטופל לא ידוע"}
            </span>
            {isReconciled ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                גושר
              </Badge>
            ) : unbilledCount > 0 ? (
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 text-xs">
                <AlertCircle className="h-3 w-3 mr-1" />
                {unbilledCount} ללא חיוב
              </Badge>
            ) : (
              <Badge className="bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 text-xs">
                חויב
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDateTime(session.startedAt)}
            {session.endedAt ? ` – ${formatDateTime(session.endedAt)}` : " (ללא שעת סיום)"}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-medium">{formatCents(session.totalBilledCents)}</p>
          <p className="text-xs text-muted-foreground">
            {session.billedCount}/{session.dispenseCount} חויב
          </p>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
          {dispensesQ.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {dispensesQ.isError && (
            <p className="text-sm text-destructive">טעינת החלוקות נכשלה</p>
          )}

          {dispensesQ.data && dispensesQ.data.length === 0 && (
            <p className="text-sm text-muted-foreground">לא נרשמו חלוקות להפעלה זו</p>
          )}

          {dispensesQ.data && dispensesQ.data.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                חלוקות
              </p>
              {dispensesQ.data.map((d: CodeBlueDispense) => (
                <div
                  key={d.inventoryLogId}
                  className="flex items-center justify-between gap-3 text-sm py-1.5 px-3 rounded-lg bg-background border"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.itemName}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(d.dispensedAt)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs">כמות: {Math.abs(d.quantityDispensed)}</p>
                    {d.billedCents != null ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        {formatCents(d.billedCents)}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">ללא חיוב</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isReconciled && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => reconcileMut.mutate()}
              disabled={reconcileMut.isPending}
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {reconcileMut.isPending ? "מסמן..." : "סמן כגושר"}
            </Button>
          )}

          {isReconciled && session.reconciledAt && (
            <p className="text-xs text-muted-foreground">
              גושר ב-{formatDateTime(session.reconciledAt)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function CodeBlueReconciliationPage() {
  const { userId, isAdmin } = useAuth();

  const sessionsQ = useQuery({
    queryKey: ["/api/code-blue/reconciliation"],
    queryFn: () => api.codeBlue.reconciliationList().then((r) => r.sessions),
    enabled: !!userId && isAdmin,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (!isAdmin) {
    return (
      <Layout>
        <div className="p-8 text-center text-muted-foreground">נדרשת גישת מנהל</div>
      </Layout>
    );
  }

  const sessions = sessionsQ.data ?? [];
  const pending = sessions.filter((s) => !s.isReconciled);
  const done = sessions.filter((s) => s.isReconciled);

  return (
    <Layout>
      <Helmet>
        <title>גישור קוד כחול — VetTrack</title>
      </Helmet>

      <div className="w-full space-y-6 motion-safe:animate-page-enter">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldAlert className="h-7 w-7 shrink-0 text-destructive" aria-hidden />
            <h1 className="truncate text-2xl font-bold tracking-tight">גישור קוד כחול</h1>
          </div>
          <Link href="/billing">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Receipt className="h-4 w-4" />
              חזרה לחיובים
            </Button>
          </Link>
        </div>

        <p className="text-sm text-muted-foreground max-w-2xl">
          סקור תרופות שחולקו בזמן מקרי חירום ואשר השלמת חיוב. הפעלות עם פריטים שלא חויבו מוצגות ראשונות.
        </p>

        {sessionsQ.isPending && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}

        {sessionsQ.isError && (
          <ErrorCard message="טעינת הפעלות הגישור נכשלה" />
        )}

        {!sessionsQ.isPending && !sessionsQ.isError && sessions.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            message="הכל תקין"
            subMessage="לא נמצאו הפעלות קוד כחול שהסתיימו"
          />
        )}

        {pending.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              ממתין ({pending.length})
            </h2>
            {pending.map((s) => (
              <SessionRow key={s.sessionId} session={s} />
            ))}
          </section>
        )}

        {done.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              גושר ({done.length})
            </h2>
            {done.map((s) => (
              <SessionRow key={s.sessionId} session={s} />
            ))}
          </section>
        )}
      </div>
    </Layout>
  );
}
