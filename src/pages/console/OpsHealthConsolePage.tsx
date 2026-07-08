import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type DlqItem = Awaited<ReturnType<typeof api.adminOutboxDlq.list>>["items"][number];

/** Format a nullable count/duration; `t` read lazily (safe across the locale remount). */
function fmtNum(n: number | null | undefined): string {
  return n == null ? t.console.dash : new Intl.NumberFormat().format(n);
}

function StatCard({ label, value, loading, warn }: { label: string; value: string; loading?: boolean; warn?: boolean }) {
  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-16 rounded" />
        ) : (
          <p className={`text-2xl font-bold ${warn ? "text-[var(--status-issue-fg)]" : "text-foreground"}`}>{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Ops Health console (Phase 6 scaffold → Phase 7a). OBSERVE ONLY (frozen-surface
 * doctrine: no requeue/drop/transport controls; DLQ replay lives in the ops
 * runbook). Shows the realtime outbox-health summary + the dead-letter queue
 * read-only, with a persistent read-only chip.
 */
export default function OpsHealthConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const healthQ = useQuery({
    queryKey: ["console", "ops-health", "health"],
    queryFn: () => api.adminOutboxHealth.get(),
    enabled: hasServerAccess,
    retry: false,
  });

  const dlqQ = useQuery({
    queryKey: ["console", "ops-health", "dlq"],
    queryFn: () => api.adminOutboxDlq.list(),
    enabled: hasServerAccess,
    retry: false,
  });

  const columns: Column<DlqItem>[] = [
    {
      key: "type",
      header: t.console.colType,
      sortValue: (r) => r.type,
      cell: (r) => <span className="font-mono text-xs">{r.type}</span>,
    },
    {
      key: "occurred",
      header: t.console.colOccurred,
      sortValue: (r) => r.occurredAt,
      cell: (r) => (
        <span className="text-muted-foreground">{new Date(r.occurredAt).toLocaleString()}</span>
      ),
    },
    {
      key: "retries",
      header: t.console.colRetries,
      sortValue: (r) => r.retryCount,
      cell: (r) => r.retryCount,
    },
  ];

  const health = healthQ.data;
  const permanentDlq = health?.dlq_permanent_count ?? 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.opsHealth.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.opsHealth.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>
        {hasServerAccess ? (
          <>
            <section
              aria-label={t.console.opsHealth.healthTitle}
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              <StatCard label={t.console.opsHealth.outboxSize} value={fmtNum(health?.outbox_size)} loading={healthQ.isLoading} />
              <StatCard label={t.console.opsHealth.publishLag} value={fmtNum(health?.publish_lag_ms)} loading={healthQ.isLoading} />
              <StatCard label={t.console.opsHealth.deadLettered} value={fmtNum(health?.dead_letter_count)} loading={healthQ.isLoading} />
              <StatCard
                label={t.console.opsHealth.dlqPermanent}
                value={fmtNum(permanentDlq)}
                loading={healthQ.isLoading}
                warn={permanentDlq > 0}
              />
            </section>
            <DataTable
              columns={columns}
              rows={dlqQ.data?.items}
              rowKey={(r) => String(r.id)}
              isLoading={dlqQ.isLoading}
              isError={dlqQ.isError}
              onRetry={() => dlqQ.refetch()}
              emptyIcon={Activity}
              emptyMessage={t.console.state.empty}
            />
          </>
        ) : (
          <EmptyState icon={Activity} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
