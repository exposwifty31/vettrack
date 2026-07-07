import { useQuery } from "@tanstack/react-query";
import { Cable } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import type { IntegrationConfig } from "@/types/integrations";

/**
 * Integrations console (Phase 6 scaffold). Lists PMS adapter configs. Reads are
 * `requireAdmin` server-side, so a lead (management.web, no webWrite) sees the
 * chrome + an honest "pending server enablement" state rather than a 403'd fetch.
 */
export default function IntegrationsConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const configsQ = useQuery({
    queryKey: ["console", "integrations", "configs"],
    queryFn: api.integrations.listConfigs,
    enabled: hasServerAccess,
    retry: false,
  });

  const columns: Column<IntegrationConfig>[] = [
    {
      key: "adapter",
      header: t.console.colAdapter,
      sortValue: (r) => r.adapterId,
      cell: (r) => <Bdi className="font-medium">{r.adapterId}</Bdi>,
    },
    {
      key: "status",
      header: t.console.colStatus,
      sortValue: (r) => (r.enabled ? 1 : 0),
      cell: (r) => (
        <Badge variant={r.enabled ? "default" : "secondary"}>
          {r.enabled ? t.console.valEnabled : t.console.valDisabled}
        </Badge>
      ),
    },
    {
      key: "updated",
      header: t.console.colUpdated,
      sortValue: (r) => r.updatedAt,
      cell: (r) => (
        <span className="text-muted-foreground">{new Date(r.updatedAt).toLocaleDateString()}</span>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t.console.integrations.title}</h1>
          <p className="text-sm text-muted-foreground">{t.console.integrations.subtitle}</p>
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={configsQ.data}
            rowKey={(r) => r.id}
            isLoading={configsQ.isLoading}
            isError={configsQ.isError}
            onRetry={() => configsQ.refetch()}
            emptyIcon={Cable}
            emptyMessage={t.console.state.empty}
          />
        ) : (
          <EmptyState icon={Cable} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
