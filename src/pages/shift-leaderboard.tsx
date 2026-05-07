import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { useAuth } from "@/hooks/use-auth";
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

  if (!isAdmin) {
    return (
      <Layout>
        <div className="p-8 text-center text-muted-foreground">נדרשת גישת מנהל</div>
      </Layout>
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
    <Layout>
      <Helmet>
        <title>לוח מובילים — סריקות משמרת — VetTrack</title>
      </Helmet>

      <div className="w-full space-y-6 motion-safe:animate-page-enter">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <TrendingUp className="h-7 w-7 shrink-0 text-primary" aria-hidden />
            <h1 className="truncate text-2xl font-bold tracking-tight">לוח מובילים — סריקות משמרת</h1>
          </div>
          <Link href="/analytics">
            <Button variant="outline" size="sm">
              חזרה לניתוח נתונים
            </Button>
          </Link>
        </div>

        <p className="text-sm text-muted-foreground max-w-2xl">
          ספירת סריקות וממוצעים לפי משתמש על פני משמרות. משתמשים עם אפס סריקות בכל משמרת מסומנים.
        </p>

        {/* טווח תאריכים */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1 flex-1 min-w-[7rem]">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="sb-from">
                מתאריך
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
                עד תאריך
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
              {reportQ.isFetching ? "טוען..." : "הרץ דוח"}
            </Button>
          </div>
        </div>

        {/* תוצאות */}
        {reportQ.isPending && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        )}

        {reportQ.isError && (
          <ErrorCard message="טעינת נתוני השלמת משמרת נכשלה" />
        )}

        {!reportQ.isPending && !reportQ.isError && users.length === 0 && (
          <EmptyState
            icon={Users}
            message="אין נתונים"
            subMessage="אין משתמשים עם פעילות משמרת בתקופה שנבחרה"
          />
        )}

        {sorted.length > 0 && (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide border-b">
                  <th className="px-4 py-2 text-right font-medium">#</th>
                  <th className="px-4 py-2 text-right font-medium">משתמש</th>
                  <th className="px-4 py-2 text-right font-medium">משמרות</th>
                  <th className="px-4 py-2 text-right font-medium">סריקות סה״כ</th>
                  <th className="px-4 py-2 text-right font-medium">ממוצע / משמרת</th>
                  <th className="px-4 py-2 text-right font-medium">ללא סריקה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((u, idx) => {
                  const hasZeroCapture = u.zeroCaptureShifts > 0;
                  return (
                    <tr
                      key={u.userId}
                      className={`hover:bg-muted/30 transition-colors ${
                        hasZeroCapture ? "bg-amber-50/40 dark:bg-amber-950/20" : ""
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
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
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
        )}
      </div>
    </Layout>
  );
}
