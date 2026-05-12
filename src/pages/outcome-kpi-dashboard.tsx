import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OutcomeKpiRoiMetric } from "../../shared/er-types";
import type { ReactNode } from "react";
import { Activity, Handshake, Timer, TrendingUp } from "lucide-react";

const COLOR_BASELINE = "#6b7280";
const COLOR_CURRENT = "#0ea5e9";

/** Server-oriented improvement %: positive = better vs baseline. */
function ImprovementBadge({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const good = value > 0;
  return (
    <Badge
      variant="outline"
      className={cn(
        "ms-1 text-xs font-medium tabular-nums",
        good
          ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
          : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </Badge>
  );
}

function formatWindowRange(startIso: string, endIso: string): string {
  try {
    const a = new Date(startIso);
    const b = new Date(endIso);
    return `${format(a, "MMM d, yyyy HH:mm")} → ${format(b, "MMM d, yyyy HH:mm")}`;
  } catch {
    return `${startIso} → ${endIso}`;
  }
}

function MetricBarPair(props: {
  title: string;
  description: string;
  icon: ReactNode;
  baselineLabel: string;
  currentLabel: string;
  baselineDisplay: string;
  currentDisplay: string;
  metric: OutcomeKpiRoiMetric;
  chartBaselineKey: string;
  chartCurrentKey: string;
  chartNumericBaseline: number;
  chartNumericCurrent: number;
  chartFormatter: (v: number) => string;
}) {
  const {
    title,
    description,
    icon,
    baselineLabel,
    currentLabel,
    baselineDisplay,
    currentDisplay,
    metric,
    chartBaselineKey,
    chartCurrentKey,
    chartNumericBaseline,
    chartNumericCurrent,
    chartFormatter,
  } = props;

  const data = [
    { label: chartBaselineKey, v: chartNumericBaseline, fill: COLOR_BASELINE },
    { label: chartCurrentKey, v: chartNumericCurrent, fill: COLOR_CURRENT },
  ];

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          <ImprovementBadge value={metric.improvementPercent} />
        </div>
        <p className="text-muted-foreground text-xs leading-snug">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">{baselineLabel}</div>
            <div className="font-semibold tabular-nums">{baselineDisplay}</div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              n={metric.baselineSampleSize}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{currentLabel}</div>
            <div className="font-semibold tabular-nums">{currentDisplay}</div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              n={metric.currentSampleSize}
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(x) => chartFormatter(x)} />
            <Tooltip formatter={(v: number) => [chartFormatter(v), title]} />
            <Bar dataKey="v" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function OutcomeKpiDashboardPage() {
  const { userId, isAdmin } = useAuth();
  const q = useQuery({
    queryKey: ["/api/analytics/outcome-kpi-roi"],
    queryFn: api.analytics.outcomeKpiRoi,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const d = q.data;

  return (
    <Layout>
      <Helmet>
        <title>{t.outcomeKpiDashboard.title}</title>
        <meta name="description" content={t.outcomeKpiDashboard.metaDescription} />
      </Helmet>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8 animate-fade-in">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.outcomeKpiDashboard.title}</h1>
            <p className="text-muted-foreground text-sm">{t.outcomeKpiDashboard.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/analytics">{t.outcomeKpiDashboard.backAnalytics}</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/er/kpis">{t.outcomeKpiDashboard.erRollingBaseline}</Link>
            </Button>
          </div>
        </div>

        {q.isError && (
          <ErrorCard message={t.outcomeKpiDashboard.loadError} onRetry={() => q.refetch()} />
        )}

        {q.isLoading && (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        )}

        {d && !d.hasActivation && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-base">{t.outcomeKpiDashboard.noActivationTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{t.outcomeKpiDashboard.noActivationBody}</p>
              {isAdmin && (
                <details className="text-xs">
                  <summary className="cursor-pointer select-none text-muted-foreground/70 hover:text-muted-foreground">
                    {t.outcomeKpiDashboard.noActivationAdminSummary}
                  </summary>
                  <p className="mt-1 break-all rounded-lg bg-muted px-3 py-2">
                    {t.outcomeKpiDashboard.noActivationAdminHint}
                  </p>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {d && d.hasActivation && d.baselineWindow && d.currentWindow && (
          <>
            <Card className="bg-muted/30">
              <CardContent className="py-4 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <span>
                    <span className="text-muted-foreground">{t.outcomeKpiDashboard.activationLabel}: </span>
                    <span className="font-medium tabular-nums">
                      {format(new Date(d.activationAt!), "PPpp")}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">{t.outcomeKpiDashboard.baselineWindowLabel}: </span>
                    {formatWindowRange(d.baselineWindow.start, d.baselineWindow.end)}
                  </span>
                  <span>
                    <span className="text-muted-foreground">{t.outcomeKpiDashboard.currentWindowLabel}: </span>
                    {formatWindowRange(d.currentWindow.start, d.currentWindow.end)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {t.outcomeKpiDashboard.generatedAt}: {new Date(d.generatedAt).toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-3">
              <MetricBarPair
                title={t.outcomeKpiDashboard.kpiTriageTitle}
                description={t.outcomeKpiDashboard.kpiTriageDesc}
                icon={<Timer className="h-4 w-4" />}
                baselineLabel={t.outcomeKpiDashboard.baselinePeriod}
                currentLabel={t.outcomeKpiDashboard.currentPeriod}
                baselineDisplay={
                  d.timeToTriageMinutesP50.baseline !== null
                    ? `${d.timeToTriageMinutesP50.baseline} min`
                    : "—"
                }
                currentDisplay={
                  d.timeToTriageMinutesP50.current !== null
                    ? `${d.timeToTriageMinutesP50.current} min`
                    : "—"
                }
                metric={d.timeToTriageMinutesP50}
                chartBaselineKey={t.outcomeKpiDashboard.chartBaselineShort}
                chartCurrentKey={t.outcomeKpiDashboard.chartCurrentShort}
                chartNumericBaseline={d.timeToTriageMinutesP50.baseline ?? 0}
                chartNumericCurrent={d.timeToTriageMinutesP50.current ?? 0}
                chartFormatter={(v) => `${v} min`}
              />

              <MetricBarPair
                title={t.outcomeKpiDashboard.kpiHandoffTitle}
                description={t.outcomeKpiDashboard.kpiHandoffDesc}
                icon={<Handshake className="h-4 w-4" />}
                baselineLabel={t.outcomeKpiDashboard.baselinePeriod}
                currentLabel={t.outcomeKpiDashboard.currentPeriod}
                baselineDisplay={
                  d.handoffIntegrityDirectAckPercent.baseline !== null
                    ? `${d.handoffIntegrityDirectAckPercent.baseline.toFixed(1)}%`
                    : "—"
                }
                currentDisplay={
                  d.handoffIntegrityDirectAckPercent.current !== null
                    ? `${d.handoffIntegrityDirectAckPercent.current.toFixed(1)}%`
                    : "—"
                }
                metric={d.handoffIntegrityDirectAckPercent}
                chartBaselineKey={t.outcomeKpiDashboard.chartBaselineShort}
                chartCurrentKey={t.outcomeKpiDashboard.chartCurrentShort}
                chartNumericBaseline={d.handoffIntegrityDirectAckPercent.baseline ?? 0}
                chartNumericCurrent={d.handoffIntegrityDirectAckPercent.current ?? 0}
                chartFormatter={(v) => `${v.toFixed(0)}%`}
              />

              <MetricBarPair
                title={t.outcomeKpiDashboard.kpiRevenueRecoveryTitle}
                description={t.outcomeKpiDashboard.kpiRevenueRecoveryDesc}
                icon={<Activity className="h-4 w-4" />}
                baselineLabel={t.outcomeKpiDashboard.baselinePeriod}
                currentLabel={t.outcomeKpiDashboard.currentPeriod}
                baselineDisplay={
                  d.revenueRecoveryScore.baseline !== null
                    ? `${d.revenueRecoveryScore.baseline.toFixed(1)}`
                    : "—"
                }
                currentDisplay={
                  d.revenueRecoveryScore.current !== null
                    ? `${d.revenueRecoveryScore.current.toFixed(1)}`
                    : "—"
                }
                metric={d.revenueRecoveryScore}
                chartBaselineKey={t.outcomeKpiDashboard.chartBaselineShort}
                chartCurrentKey={t.outcomeKpiDashboard.chartCurrentShort}
                chartNumericBaseline={d.revenueRecoveryScore.baseline ?? 0}
                chartNumericCurrent={d.revenueRecoveryScore.current ?? 0}
                chartFormatter={(v) => v.toFixed(1)}
              />
            </div>

            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t.outcomeKpiDashboard.methodologyNote}
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
