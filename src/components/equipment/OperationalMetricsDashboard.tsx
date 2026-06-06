import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

const DATE_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

function msToDisplay(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function OperationalMetricsDashboard() {
  const [rangeDays, setRangeDays] = useState<number>(30);

  const now = new Date();
  const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/operational-metrics/summary", rangeDays],
    queryFn: () =>
      api.operationalState.metricsSummary({
        from: from.toISOString(),
        to: now.toISOString(),
      }),
  });

  if (error instanceof ApiError && error.status === 501) return null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (data?.metricsEnabled === false) {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge kind="maintenance" />
        <span className="text-sm text-muted-foreground">{t.operationalMetrics.metricsDisabled}</span>
      </div>
    );
  }

  const noData =
    data &&
    data.emergencyOverrides === 0 &&
    data.bundleFailures === 0 &&
    data.staleConditions === 0 &&
    data.procedureBounds === 0 &&
    data.averageCheckoutMs === null &&
    data.averageDockReturnMs === null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {DATE_RANGES.map((r) => (
          <Button
            key={r.days}
            size="sm"
            variant={rangeDays === r.days ? "default" : "outline"}
            onClick={() => setRangeDays(r.days)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      {noData ? (
        <p className="text-sm text-muted-foreground">{t.operationalMetrics.noData}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard title={t.operationalMetrics.emergencyOverrides} value={data?.emergencyOverrides ?? 0} />
          <MetricCard title={t.operationalMetrics.bundleFailures} value={data?.bundleFailures ?? 0} />
          <MetricCard title={t.operationalMetrics.staleConditions} value={data?.staleConditions ?? 0} />
          <MetricCard title={t.operationalMetrics.procedureBounds} value={data?.procedureBounds ?? 0} />
          <MetricCard title={t.operationalMetrics.averageCheckoutTime} value={msToDisplay(data?.averageCheckoutMs ?? null)} />
          <MetricCard title={t.operationalMetrics.averageDockReturnTime} value={msToDisplay(data?.averageDockReturnMs ?? null)} />
          {data?.deployableSuccessRate != null && (
            <MetricCard
              title={t.operationalMetrics.deployableSuccessRate}
              value={`${Math.round(data.deployableSuccessRate * 100)}%`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
