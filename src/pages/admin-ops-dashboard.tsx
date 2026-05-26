import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
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

  const outboxQ = useQuery({
    queryKey: ["/api/admin/outbox-health"],
    queryFn: api.adminOutboxHealth.get,
    enabled: isAdmin,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });

  const queueQ = useQuery({
    queryKey: ["/api/queue/metrics"],
    queryFn: api.adminQueueMetrics.get,
    enabled: isAdmin,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });

  const runtimeMetricsQ = useQuery({
    queryKey: ["/api/metrics"],
    queryFn: api.metrics.get,
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

  const d = outboxQ.data;
  const qd = queueQ.data;
  const offlineSync = runtimeMetricsQ.data?.offlineSync;

  return (
    <Layout title={t.adminOpsDashboard.title}>
      <Helmet>
        <title>{t.adminOpsDashboard.title}</title>
      </Helmet>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t.adminOpsDashboard.title}</h1>
          <p className="text-sm text-muted-foreground">{t.adminOpsDashboard.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.adminOpsDashboard.liveHint}</p>
        </div>

        {/* Event outbox / realtime pipeline */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title={t.adminOpsDashboard.publishLag}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
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
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
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
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            highlightDestructive={(d?.dead_letter_count ?? 0) > 0}
            value={d != null ? d.dead_letter_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.dlqPermanentCount}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            highlightDestructive={(d?.dlq_permanent_count ?? 0) > 0}
            value={d != null ? d.dlq_permanent_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.dlqTransientCount}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            value={d != null ? d.dlq_transient_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.dlqUnclassifiedCount}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            value={d != null ? d.dlq_unclassified_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.gapResyncCount}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            value={d != null ? d.gap_resync_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.duplicateDropsCount}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            value={d != null ? d.duplicate_drops_count.toLocaleString() : null}
          />
          <MetricCard
            title={t.adminOpsDashboard.nextRetryWave}
            description={t.adminOpsDashboard.nextRetryWaveHint}
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
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
            loading={outboxQ.isLoading}
            error={outboxQ.isError}
            value={
              d?.max_retry_horizon_ms == null ? (
                <span className="text-muted-foreground">{t.adminOpsDashboard.maxRetryHorizonEmpty}</span>
              ) : (
                formatRetryEta(d.max_retry_horizon_ms)
              )
            }
          />
        </div>

        {outboxQ.isError && (
          <p className="text-sm text-destructive">{(outboxQ.error as Error)?.message ?? "Error"}</p>
        )}

        <div className="border-t" />

        {/* OFF-08 — offline Dexie queue telemetry (server aggregates) */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t.adminOpsDashboard.offlineSyncTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.adminOpsDashboard.offlineSyncSubtitle}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title={t.adminOpsDashboard.offlineSyncPendingReports}
              loading={runtimeMetricsQ.isLoading}
              error={runtimeMetricsQ.isError}
              value={
                offlineSync == null ? null : (
                  <OfflineSyncBucketSummary
                    buckets={[
                      offlineSync.pendingReported.zero,
                      offlineSync.pendingReported.one,
                      offlineSync.pendingReported.twoToFive,
                      offlineSync.pendingReported.sixPlus,
                    ]}
                    labels={["0", "1", "2–5", "6+"]}
                  />
                )
              }
            />
            <MetricCard
              title={t.adminOpsDashboard.offlineSyncDeadLetterReports}
              loading={runtimeMetricsQ.isLoading}
              error={runtimeMetricsQ.isError}
              highlightDestructive={
                (offlineSync?.deadLetter.one ?? 0) + (offlineSync?.deadLetter.twoPlus ?? 0) > 0
              }
              value={
                offlineSync == null ? null : (
                  <OfflineSyncBucketSummary
                    buckets={[
                      offlineSync.deadLetter.zero,
                      offlineSync.deadLetter.one,
                      offlineSync.deadLetter.twoPlus,
                    ]}
                    labels={["0", "1", "2+"]}
                  />
                )
              }
            />
            <MetricCard
              title={t.adminOpsDashboard.offlineSyncConflictReports}
              loading={runtimeMetricsQ.isLoading}
              error={runtimeMetricsQ.isError}
              highlightDestructive={(offlineSync?.conflict.onePlus ?? 0) > 0}
              value={
                offlineSync == null ? null : (
                  <OfflineSyncBucketSummary
                    buckets={[offlineSync.conflict.zero, offlineSync.conflict.onePlus]}
                    labels={["0", "1+"]}
                  />
                )
              }
            />
            <MetricCard
              title={t.adminOpsDashboard.offlineSyncOldestAgeReports}
              loading={runtimeMetricsQ.isLoading}
              error={runtimeMetricsQ.isError}
              value={
                offlineSync == null ? null : (
                  <OfflineSyncBucketSummary
                    buckets={[
                      offlineSync.oldestPendingAge.none,
                      offlineSync.oldestPendingAge.lt60s,
                      offlineSync.oldestPendingAge.lt5m,
                      offlineSync.oldestPendingAge.lt1h,
                      offlineSync.oldestPendingAge.gte1h,
                    ]}
                    labels={["—", "<1m", "<5m", "<1h", "≥1h"]}
                  />
                )
              }
            />
          </div>
          {runtimeMetricsQ.isError && (
            <p className="text-sm text-destructive">
              {(runtimeMetricsQ.error as Error)?.message ?? "Error"}
            </p>
          )}
        </div>

        <div className="border-t" />

        {/* BullMQ notification queue section */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{t.adminOpsDashboard.notificationQueueTitle}</h2>
            {queueQ.data != null && (
              <Badge
                variant={qd?.isDegraded ? "destructive" : "outline"}
                className={cn(
                  "text-xs",
                  !qd?.isDegraded && "border-green-600 text-green-700 dark:text-green-400",
                )}
              >
                {qd?.isDegraded
                  ? t.adminOpsDashboard.queueDegraded
                  : t.adminOpsDashboard.queueHealthy}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {t.adminOpsDashboard.notificationQueueSubtitle}
          </p>

          {!qd?.redisAvailable && qd != null && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {t.adminOpsDashboard.queueRedisUnavailable}
            </p>
          )}

          {qd?.isDegraded && (
            <p className="text-sm text-destructive">{t.adminOpsDashboard.queueDegradedHint}</p>
          )}

          {/* Worker heartbeat */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title={t.adminOpsDashboard.workerHeartbeat}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              highlightDestructive={
                qd?.workerHeartbeat.status === "dead" ||
                qd?.workerHeartbeat.status === "stale"
              }
              value={
                qd == null ? null : (
                  <HeartbeatValue
                    status={qd.workerHeartbeat.status}
                    ageMs={qd.workerHeartbeat.ageMs}
                  />
                )
              }
            />

            {/* Live BullMQ queue counts */}
            <MetricCard
              title={t.adminOpsDashboard.queueWaiting}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              value={qd?.queue.live != null ? (qd.queue.live.wait ?? 0).toLocaleString() : "—"}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueActive}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              value={qd?.queue.live != null ? (qd.queue.live.active ?? 0).toLocaleString() : "—"}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueFailed}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              highlightDestructive={(qd?.queue.live?.failed ?? 0) > 0}
              value={qd?.queue.live != null ? (qd.queue.live.failed ?? 0).toLocaleString() : "—"}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueDelayed}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              value={qd?.queue.live != null ? (qd.queue.live.delayed ?? 0).toLocaleString() : "—"}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueCompleted}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              value={qd?.queue.live != null ? (qd.queue.live.completed ?? 0).toLocaleString() : "—"}
            />

            {/* DLQ counts */}
            <MetricCard
              title={t.adminOpsDashboard.queueDlqWaiting}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              highlightDestructive={(qd?.dlq.live?.wait ?? 0) > 0}
              value={qd?.dlq.live != null ? (qd.dlq.live.wait ?? 0).toLocaleString() : "—"}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueDlqFailed}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              highlightDestructive={(qd?.dlq.live?.failed ?? 0) > 0}
              value={qd?.dlq.live != null ? (qd.dlq.live.failed ?? 0).toLocaleString() : "—"}
            />

            {/* In-process counters */}
            <MetricCard
              title={t.adminOpsDashboard.queueEnqueued}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              value={qd?.queue.inProcess != null ? qd.queue.inProcess.enqueued.toLocaleString() : null}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueRetried}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              value={
                qd?.queue.inProcess != null
                  ? (qd.queue.inProcess.failed - (qd.queue.live?.failed ?? 0) > 0
                      ? qd.queue.inProcess.failed.toLocaleString()
                      : "0")
                  : null
              }
            />
            <MetricCard
              title={t.adminOpsDashboard.queueDroppedRateLimit}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              highlightDestructive={(qd?.queue.inProcess.droppedRateLimit ?? 0) > 0}
              value={qd?.queue.inProcess != null ? qd.queue.inProcess.droppedRateLimit.toLocaleString() : null}
            />
            <MetricCard
              title={t.adminOpsDashboard.queueDroppedNoRedis}
              loading={queueQ.isLoading}
              error={queueQ.isError}
              highlightDestructive={(qd?.queue.inProcess.droppedNoRedis ?? 0) > 0}
              value={qd?.queue.inProcess != null ? qd.queue.inProcess.droppedNoRedis.toLocaleString() : null}
            />
          </div>
        </div>

        {queueQ.isError && (
          <p className="text-sm text-destructive">{(queueQ.error as Error)?.message ?? "Error"}</p>
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

function HeartbeatValue(props: { status: "ok" | "stale" | "dead" | "no_redis"; ageMs: number | null }) {
  const { status, ageMs } = props;
  const labelMap: Record<typeof status, string> = {
    ok: t.adminOpsDashboard.workerHeartbeatOk,
    stale: t.adminOpsDashboard.workerHeartbeatStale,
    dead: t.adminOpsDashboard.workerHeartbeatDead,
    no_redis: t.adminOpsDashboard.workerHeartbeatNoRedis,
  };
  const label = labelMap[status];
  const locale = getCurrentLocale() === "he" ? heLocale : enUS;
  const ageLabel =
    ageMs != null && Number.isFinite(ageMs)
      ? formatDistanceToNow(new Date(Date.now() - ageMs), { locale, addSuffix: true })
      : null;
  return (
    <span className="text-base font-semibold">
      {label}
      {ageLabel && (
        <span className="block text-sm font-normal text-muted-foreground">{ageLabel}</span>
      )}
    </span>
  );
}

function OfflineSyncBucketSummary(props: { buckets: number[]; labels: string[] }) {
  const total = props.buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return <span className="text-base text-muted-foreground">—</span>;
  }
  return (
    <ul className="space-y-1 text-sm font-normal text-muted-foreground">
      {props.labels.map((label, i) => (
        <li key={label} className="flex justify-between gap-4 tabular-nums">
          <span>{label}</span>
          <span className="font-semibold text-foreground">{props.buckets[i]?.toLocaleString() ?? 0}</span>
        </li>
      ))}
    </ul>
  );
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
