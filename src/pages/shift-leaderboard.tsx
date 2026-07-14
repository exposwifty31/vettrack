import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { useAuth } from "@/hooks/use-auth";
import { ManagementAccessDenied } from "@/desktop/management";
import { t } from "@/lib/i18n";
import { TrendingUp, AlertCircle, Users } from "lucide-react";
import { Link } from "wouter";

function getDefaultDates(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function ShiftLeaderboardPage() {
  const { userId, isAdmin } = useAuth();
  const defaults = useMemo(() => getDefaultDates(), []);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [queryParams, setQueryParams] = useState<{ from: string; to: string }>(defaults);

  const reportQ = useQuery({
    queryKey: ["/api/analytics/shift-completion", queryParams],
    queryFn: () =>
      api.analytics.shiftCompletion(
        new Date(queryParams.from).toISOString(),
        new Date(queryParams.to + "T23:59:59").toISOString(),
      ),
    enabled: !!userId && isAdmin,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // T22: literal isAdmin — /api/analytics/shift-completion is requireAdmin-only
  // server-side, narrower than the lead-inclusive management.web floor.
  if (!isAdmin) {
    return (
      <AppShell>
        <ManagementAccessDenied />
      </AppShell>
    );
  }

  const users = reportQ.data?.users ?? [];
  const sorted = [...users]
    .map((u) => ({
      ...u,
      avgScansPerShift:
        typeof u.avgScansPerShift === "number" ? u.avgScansPerShift : Number(u.avgScansPerShift ?? 0),
    }))
    .sort((a, b) => b.avgScansPerShift - a.avgScansPerShift);

  return (
    <AppShell>
      <Helmet>
        <title>{t.shiftLeaderboard.pageTitle}</title>
      </Helmet>

      <div className="w-full space-y-6 motion-safe:animate-page-enter">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <TrendingUp className="h-7 w-7 shrink-0 text-primary" aria-hidden />
            <h1 className="truncate text-2xl font-bold tracking-tight">{t.shiftLeaderboard.title}</h1>
          </div>
          <Link href="/analytics">
            <Button variant="outline" size="sm">
              {t.shiftLeaderboard.backToAnalytics}
            </Button>
          </Link>
        </div>

        <p className="text-sm text-muted-foreground max-w-2xl">
          {t.shiftLeaderboard.description}
        </p>

        {/* Date range */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1 flex-1 min-w-[7rem]">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="sb-from">
                {t.shiftLeaderboard.fromDate}
              </label>
              <input
                id="sb-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[7rem]">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="sb-to">
                {t.shiftLeaderboard.toDate}
              </label>
              <input
                id="sb-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button
              onClick={() => setQueryParams({ from: fromDate, to: toDate })}
              disabled={reportQ.isFetching}
            >
              {reportQ.isFetching ? t.shiftLeaderboard.loading : t.shiftLeaderboard.runReport}
            </Button>
          </div>
        </div>

        {/* Results */}
        {reportQ.isPending && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        )}

        {reportQ.isError && (
          <ErrorCard message={t.shiftLeaderboard.loadError} />
        )}

        {!reportQ.isPending && !reportQ.isError && users.length === 0 && (
          <EmptyState
            icon={Users}
            message={t.shiftLeaderboard.emptyTitle}
            subMessage={t.shiftLeaderboard.emptySubtitle}
          />
        )}

        {sorted.length > 0 && (
          <div className="overflow-x-auto">
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm table-fixed min-w-[520px]">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide border-b">
                  <th className="px-4 py-2 text-right font-medium">#</th>
                  <th className="px-4 py-2 text-right font-medium">{t.shiftLeaderboard.colUser}</th>
                  <th className="px-4 py-2 text-right font-medium">{t.shiftLeaderboard.colShifts}</th>
                  <th className="px-4 py-2 text-right font-medium">{t.shiftLeaderboard.colTotalScans}</th>
                  <th className="px-4 py-2 text-right font-medium">{t.shiftLeaderboard.colAvgPerShift}</th>
                  <th className="px-4 py-2 text-right font-medium">{t.shiftLeaderboard.colNoScan}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((u, idx) => {
                  const hasZeroCapture = u.zeroCaptureShifts > 0;
                  return (
                    <tr
                      key={u.userId}
                      className={`hover:bg-muted/30 transition-colors ${
                        hasZeroCapture ? "bg-[var(--status-stale-bg)]" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.shiftCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.totalScans}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {u.avgScansPerShift.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasZeroCapture ? (
                          <span className="inline-flex items-center gap-1 text-[var(--status-stale-fg)] font-medium">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {u.zeroCaptureShifts}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
