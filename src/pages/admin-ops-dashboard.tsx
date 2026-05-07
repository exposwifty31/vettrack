import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { getCurrentLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { enUS, he as heLocale } from "date-fns/locale";
import type { ReactNode } from "react";

const POLL_MS = 10_000;

export default function AdminOpsDashboardPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const q = useQuery({
    queryKey: ["/api/admin/outbox-health"],
    queryFn: api.adminOutboxHealth.get,
    enabled: isAdmin,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });

  if (!isAdmin) {
    return (
      <Layout title={t.adminOpsDashboard.title}>
        <p className="text-sm text-muted-foreground">{t.adminOpsDashboard.accessDenied}</p>
      </Layout>
    );
  }

  const d = q.data;

  return (
    <Layout title={t.adminOpsDashboard.title}>
      <Helmet>
        <title>{t.adminOpsDashboard.title}</title>
      </Helmet>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">{t.adminOpsDashboard.title}</h1>
          <p className="text-sm text-muted-foreground">{t.adminOpsDashboard.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.adminOpsDashboard.liveHint}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title={t.adminOpsDashboard.publishLag}
            loading={q.isLoading}
            error={q.isError}
            value={
              d?.publish_lag_ms == null ? (
                <span className="text-muted-foreground">{t.adminOpsDashboard.publishLagEmpty}</span>
              ) : (
                <>
                  {Math.round(d.publish_lag_ms).toLocaleString()}{" "}
                  <span className="text-lg font-normal text-muted-foreground">
                    {t.adminOpsDashboard.publishLagMs}
                  </span>
                </>
              )
            }
          />
          <MetricCard
            title={t.adminOpsDashboard.eventsPerSec}
            loading={q.isLoading}
            error={q.isError}
            value={
              d ? (
                d.events_per_sec.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 3,
                })
              ) : null
            }
          />
          <MetricCard
            title={t.adminOpsDashboard.deadLetterCount}
            loading={q.isLoading}
            error={q.isError}
            highlightDestructive={(d?.dead_letter_count ?? 0) > 0}
            value={d != null ? d.dead_letter_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.dlqPermanentCount}
            loading={q.isLoading}
            error={q.isError}
            highlightDestructive={(d?.dlq_permanent_count ?? 0) > 0}
            value={d != null ? d.dlq_permanent_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.dlqTransientCount}
            loading={q.isLoading}
            error={q.isError}
            value={d != null ? d.dlq_transient_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.dlqUnclassifiedCount}
            loading={q.isLoading}
            error={q.isError}
            value={d != null ? d.dlq_unclassified_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.gapResyncCount}
            loading={q.isLoading}
            error={q.isError}
            value={d != null ? d.gap_resync_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.duplicateDropsCount}
            loading={q.isLoading}
            error={q.isError}
            value={d != null ? d.duplicate_drops_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.nextRetryWave}
            description={t.adminOpsDashboard.nextRetryWaveHint}
            loading={q.isLoading}
            error={q.isError}
            value={
              d?.next_retry_wave_in_ms == null ? (
                <span className="text-muted-foreground">{t.adminOpsDashboard.nextRetryWaveEmpty}</span>
              ) : (
                formatRetryEta(d.next_retry_wave_in_ms)
              )
            }
          />
          <MetricCard
            title={t.adminOpsDashboard.maxRetryHorizon}
            description={t.adminOpsDashboard.maxRetryHorizonHint}
            loading={q.isLoading}
            error={q.isError}
            value={
              d?.max_retry_horizon_ms == null ? (
                <span className="text-muted-foreground">{t.adminOpsDashboard.maxRetryHorizonEmpty}</span>
              ) : (
                formatRetryEta(d.max_retry_horizon_ms)
              )
            }
          />
        </div>

        {q.isError && (
          <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Error"}</p>
        )}
      </div>
    </Layout>
  );
}

/** Relative ETA ("in 2 minutes") using the active UI locale. */
function formatRetryEta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const target = new Date(Date.now() + ms);
  const locale = getCurrentLocale() === "he" ? heLocale : enUS;
  return formatDistanceToNow(target, { locale, addSuffix: true });
}

function MetricCard(props: {
  title: string;
  description?: string;
  loading: boolean;
  error: boolean;
  value: ReactNode;
  highlightDestructive?: boolean;
}) {
  const { title, description, loading, error, value, highlightDestructive } = props;
  return (
    <Card
      className={cn(
        highlightDestructive &&
          "border-destructive/60 bg-destructive/5 dark:bg-destructive/10",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-28" />
        ) : error ? (
          <span className="text-sm text-destructive">—</span>
        ) : (
          <p
            className={cn(
              "text-3xl font-semibold tabular-nums tracking-tight",
              highlightDestructive && "text-destructive",
            )}
          >
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
