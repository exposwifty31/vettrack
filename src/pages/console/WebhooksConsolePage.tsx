import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Webhook } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { formatRelativeTime } from "@/lib/relative-time";
import { consoleStatusLabel } from "@/lib/console-status-label";
import type { WebhookEventRow } from "@/types";

/**
 * Webhooks console (Phase 7b). Read-only view over the clinic's INBOUND PMS webhook
 * event log (GET /api/admin/webhooks). The event payload is never fetched or shown —
 * only the envelope (adapter, status, signature validity, timestamps). Inbound-only;
 * outbound delivery config is a future surface. Reads are requireAdmin, so a lead
 * sees the honest pending-server state.
 */
export default function WebhooksConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const eventsQ = useQuery({
    queryKey: ["console", "webhooks"],
    queryFn: async () => (await api.webhooks.list()).events,
    enabled: hasServerAccess,
    retry: false,
  });

  const columns = useMemo<Column<WebhookEventRow>[]>(
    () => [
      {
        key: "adapter",
        header: t.console.colAdapter,
        sortValue: (r) => r.adapterId,
        cell: (r) => <Bdi className="font-medium">{r.adapterId}</Bdi>,
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (r) => r.status,
        cell: (r) => <Badge variant="secondary">{consoleStatusLabel(r.status)}</Badge>,
      },
      {
        key: "signature",
        header: t.console.colSignature,
        sortValue: (r) => (r.signatureValid ? 1 : 0),
        cell: (r) => (
          <Badge variant={r.signatureValid ? "ok" : "issue"}>
            {r.signatureValid ? t.console.sigValid : t.console.sigInvalid}
          </Badge>
        ),
      },
      {
        key: "received",
        header: t.console.colOccurred,
        sortValue: (r) => r.createdAt,
        cell: (r) => formatRelativeTime(new Date(r.createdAt)),
      },
      {
        key: "processed",
        header: t.console.colProcessed,
        sortValue: (r) => r.processedAt ?? "",
        cell: (r) =>
          r.processedAt ? (
            formatRelativeTime(new Date(r.processedAt))
          ) : (
            <span className="text-muted-foreground">{t.console.dash}</span>
          ),
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.webhooks.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.webhooks.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={eventsQ.data}
            rowKey={(r) => r.id}
            isLoading={eventsQ.isLoading}
            isError={eventsQ.isError}
            onRetry={() => eventsQ.refetch()}
            emptyIcon={Webhook}
            emptyMessage={t.console.state.empty}
          />
        ) : (
          <EmptyState icon={Webhook} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
