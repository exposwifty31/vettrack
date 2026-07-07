import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";

type DlqItem = Awaited<ReturnType<typeof api.adminOutboxDlq.list>>["items"][number];

/**
 * Ops Health console (Phase 6 scaffold) — OBSERVE ONLY (frozen-surface doctrine:
 * no requeue/drop/transport controls; DLQ replay lives in the ops runbook). Shows
 * the outbox dead-letter queue read-only, with a persistent read-only chip.
 */
export default function OpsHealthConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

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
        ) : (
          <EmptyState icon={Activity} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
