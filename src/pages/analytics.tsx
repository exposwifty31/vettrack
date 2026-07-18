import { t } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TruncatedText } from "@/components/ui/truncated-text";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { Payload } from "recharts/types/component/DefaultLegendContent";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/hooks/use-auth";
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Droplets,
  Activity,
  Trophy,
  TrendingUp,
  Gauge,
  PackageOpen,
  Timer,
  Download,
  MapPin,
} from "lucide-react";
import { formatChartBucketDay } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Bdi } from "@/components/ui/bdi";
import { toCsv, downloadCsv, type CsvCell } from "@/lib/csv-export";
import { ReadinessForecastPanel } from "@/features/analytics/ReadinessForecastPanel";

const STATUS_COLORS = {
  ok: "hsl(var(--status-ok))",
  issue: "hsl(var(--status-issue))",
  maintenance: "hsl(var(--status-maintenance))",
  sterilized: "hsl(var(--status-sterilized))",
};

export default function AnalyticsPage() {
  const { userId } = useAuth();
  const [, navigate] = useLocation();
  const { data: analytics, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/analytics"],
    queryFn: api.analytics.summary,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // R-PDF-1 predictive readiness. Read-only; failure is non-fatal (its section
  // shows a scoped error + retry) so a forecast error never blanks the page.
  const {
    data: readinessForecast,
    isLoading: forecastLoading,
    isError: forecastError,
    refetch: refetchForecast,
  } = useQuery({
    queryKey: ["/api/analytics/readiness-forecast"],
    queryFn: api.analytics.readinessForecast,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const pieData = analytics
    ? [
        { name: t.status.ok, value: analytics.statusBreakdown.ok, color: STATUS_COLORS.ok },
        { name: t.status.issue, value: analytics.statusBreakdown.issue, color: STATUS_COLORS.issue },
        { name: t.analyticsPage.maintenance, value: analytics.statusBreakdown.maintenance, color: STATUS_COLORS.maintenance },
        { name: t.status.sterilized, value: analytics.statusBreakdown.sterilized, color: STATUS_COLORS.sterilized },
      ].filter((d) => d.value > 0)
    : [];

  const chartData = analytics?.scanActivity
    ? analytics.scanActivity.slice(-14).map((d) => ({
        date: formatChartBucketDay(d.date),
        scans: d.count,
      }))
    : [];
  const hasScanActivity = chartData.some((d) => d.scans > 0);

  const dwellLabel = (seconds: number | null | undefined): string => {
    if (seconds == null) return t.console.dash;
    const hours = Math.round(seconds / 3600);
    return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  };

  const handleExport = () => {
    if (!analytics) return;
    const kpiRows: CsvCell[][] = [
      [t.analyticsPage.maintenance, `${analytics.maintenanceComplianceRate}%`],
      [t.analyticsPage.sterilization, `${analytics.sterilizationComplianceRate}%`],
      [t.console.analytics.readyRate, analytics.readiness ? `${analytics.readiness.readyPct}%` : ""],
      [t.console.analytics.checkedOut, analytics.occupancy ? `${analytics.occupancy.currentlyCheckedOutPct}%` : ""],
      [t.console.analytics.inUse, analytics.occupancy ? `${analytics.occupancy.currentlyInUsePct}%` : ""],
      [t.console.analytics.onTimeTitle, analytics.taskOnTime?.onTimePct != null ? `${analytics.taskOnTime.onTimePct}%` : ""],
    ];
    const perRoomRows: CsvCell[][] = (analytics.perRoom ?? []).map((r) => [
      r.roomName || t.console.analytics.unassignedRoom,
      r.total,
      r.inUse,
    ]);
    const csv = [
      toCsv([t.analyticsPage.title, ""], kpiRows),
      "",
      toCsv([t.console.colRoom, t.console.analytics.colTotal, t.console.analytics.colInUse], perRoomRows),
    ].join("\r\n");
    downloadCsv("vettrack-analytics.csv", csv);
  };

  const pageContent = (
    <>
      <Helmet>
        <title>Analytics — VetTrack</title>
        <meta name="description" content="Equipment analytics for veterinary clinics — maintenance compliance rates, sterilization compliance, scan activity over 14 days, and top problem equipment." />
        <link rel="canonical" href="https://vettrack.replit.app/analytics" />
      </Helmet>
      <div className="flex flex-col gap-5 pb-24 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight">{t.analyticsPage.title}</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!analytics}
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              {t.console.analytics.exportCsv}
            </Button>
            <Link href="/analytics/shift-leaderboard">
              <span className="inline-flex items-center gap-1.5 rounded-xl border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted/50 transition-colors cursor-pointer">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                {t.analyticsPage.shiftLeaderboardLink}
              </span>
            </Link>
          </div>
        </div>

        {isError && (
          <ErrorCard
            message={t.analyticsPage.loadFailed}
            onRetry={() => refetch()}
          />
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          {isLoading ? (
            <>
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </>
          ) : (
            <>
              <Card className="bg-card border-border/60 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-[hsl(var(--status-ok))]" />
                    <span className="text-xs text-muted-foreground font-medium">{t.analyticsPage.maintenance}</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {analytics?.maintenanceComplianceRate ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.analyticsPage.complianceRate}</p>
                </CardContent>
              </Card>

              <Card className="bg-card border-border/60 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Droplets className="w-4 h-4 text-[hsl(var(--status-sterilized))]" />
                    <span className="text-xs text-muted-foreground font-medium">{t.analyticsPage.sterilization}</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {analytics?.sterilizationComplianceRate ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.analyticsPage.complianceRate}</p>
                </CardContent>
              </Card>

              <Card className="bg-card border-border/60 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-[hsl(var(--status-stale))]" />
                    <span className="text-xs text-muted-foreground font-medium">{t.analyticsPage.overdue}</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {analytics?.statusBreakdown.overdue ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.analyticsPage.overdueItems}</p>
                </CardContent>
              </Card>

              <Card className="bg-card border-border/60 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="w-4 h-4 text-[hsl(var(--status-issue))]" />
                    <span className="text-xs text-muted-foreground font-medium">{t.analyticsPage.issues}</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {analytics?.statusBreakdown.issue ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.analyticsPage.openIssues}</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Phase 7e KPIs — readiness, occupancy, task on-time (all real-data-backed) */}
        {!isLoading && analytics && (
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="bg-card border-border/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Gauge className="w-4 h-4 text-[hsl(var(--status-ok))]" />
                  <span className="text-xs text-muted-foreground font-medium">{t.console.analytics.readinessTitle}</span>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {analytics.readiness ? `${analytics.readiness.readyPct}%` : t.console.dash}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.console.analytics.readyRate}</p>
                {analytics.readiness && (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {t.console.analytics.notReadyBacklog}:{" "}
                      <span className="tabular-nums">{analytics.readiness.notReady}</span>
                    </span>
                    <span>
                      {t.console.analytics.dwellLabel} {dwellLabel(analytics.readiness.avgNotReadyDwellSeconds)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <PackageOpen className="w-4 h-4 text-[hsl(var(--status-issue))]" />
                  <span className="text-xs text-muted-foreground font-medium">{t.console.analytics.occupancyTitle}</span>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {analytics.occupancy ? `${analytics.occupancy.currentlyInUsePct}%` : t.console.dash}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.console.analytics.inUse}</p>
                {analytics.occupancy && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.console.analytics.checkedOut}: {analytics.occupancy.currentlyCheckedOutPct}%
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Timer className="w-4 h-4 text-[hsl(var(--status-maintenance))]" />
                  <span className="text-xs text-muted-foreground font-medium">{t.console.analytics.onTimeTitle}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {analytics.taskOnTime?.onTimePct != null ? `${analytics.taskOnTime.onTimePct}%` : t.console.dash}
                  </p>
                  {analytics.taskOnTime?.deltaPct != null && analytics.taskOnTime.deltaPct !== 0 && (
                    <span
                      className={`text-xs font-semibold ${analytics.taskOnTime.deltaPct > 0 ? "text-[hsl(var(--status-ok))]" : "text-[hsl(var(--status-issue))]"}`}
                    >
                      {analytics.taskOnTime.deltaPct > 0 ? "▲" : "▼"} {Math.abs(analytics.taskOnTime.deltaPct)}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{t.console.analytics.onTimeCompleted}</p>
                <p className="text-xs text-muted-foreground mt-1">{t.console.analytics.vsPrevious}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* R-PDF-1 predictive readiness (read-only PO recommendations) */}
        {forecastError ? (
          <ErrorCard message={t.readinessForecast.loadError} onRetry={() => refetchForecast()} />
        ) : forecastLoading ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : readinessForecast ? (
          <ReadinessForecastPanel
            data={readinessForecast}
            onCreatePurchaseOrder={() => navigate("/procurement")}
          />
        ) : null}

        {/* Status distribution */}
        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-foreground">{t.analyticsPage.statusDistribution}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [`${value} ${t.analyticsPage.itemsLabel}`, ""]}
                    contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                  />
                  <Legend
                    formatter={(value, entry: Payload) =>
                      `${value}: ${entry.payload?.value ?? 0}`
                    }
                    wrapperStyle={{ fontSize: "11px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-10 text-sm">{t.analyticsPage.noDataYet}</p>
            )}
          </CardContent>
        </Card>

        {/* Scan activity chart */}
        <Card className="bg-card border-border/60 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              {t.analyticsPage.scanActivity14Days}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <Skeleton className="h-44 rounded-xl" />
            ) : hasScanActivity ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={1} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                  />
                  <Bar dataKey="scans" fill="hsl(var(--status-ok))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={Activity}
                message={t.analyticsPage.noScanActivity}
                headingLevel="h3"
              />
            )}
          </CardContent>
        </Card>

        {/* Top problem equipment */}
        {!isLoading && (
          <Card className="bg-card border-border/60 shadow-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Trophy className="w-4 h-4 text-muted-foreground" />
                {t.analyticsPage.topProblemEquipment}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!analytics?.topProblemEquipment || analytics.topProblemEquipment.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  message={t.analyticsPage.noIssuesReported}
                  subMessage={t.analyticsPage.topProblemSubMessage}
                  iconBg="bg-muted"
                  iconColor="text-muted-foreground"
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {analytics.topProblemEquipment.map((item, i) => (
                    <div key={item.equipmentId} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground shrink-0">
                          {i + 1}
                        </span>
                        <TruncatedText text={item.name} className="text-sm font-medium min-w-0" />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 bg-muted px-2.5 py-1 rounded-full">
                        {t.analyticsPage.issueCountBadge(item.issueCount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Per-room equipment distribution (snapshot) */}
        {!isLoading && analytics?.perRoom && analytics.perRoom.length > 0 && (
          <Card className="bg-card border-border/60 shadow-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                {t.console.analytics.perRoomTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-start font-medium py-1.5">{t.console.colRoom}</th>
                      <th className="text-end font-medium py-1.5">{t.console.analytics.colTotal}</th>
                      <th className="text-end font-medium py-1.5">{t.console.analytics.colInUse}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.perRoom.map((r) => (
                      <tr key={r.roomId} className="border-t border-border/50">
                        <td className="py-1.5">
                          <Bdi>{r.roomName || t.console.analytics.unassignedRoom}</Bdi>
                        </td>
                        <td className="py-1.5 text-end tabular-nums">{r.total}</td>
                        <td className="py-1.5 text-end tabular-nums">{r.inUse}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
