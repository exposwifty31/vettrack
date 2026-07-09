import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import type { IntegrationAdapter } from "@/types/integrations";

/** One row per REGISTERED adapter, joined with its clinic config (if any). */
type AdapterRow = IntegrationAdapter & { configured: boolean; enabled: boolean };

/**
 * Integrations console (Phase 6 scaffold → Phase 7b). Binds to the adapter
 * REGISTRY (api.integrations.adapters) joined with the clinic's configs, so every
 * available adapter is listed with its configured/enabled status and the credential
 * field NAMES it requires — never the secret values (secrets never round-trip).
 * Read-only in this slice; config editing is a later surface. Reads are
 * `requireAdmin`, so a lead sees the honest "pending server enablement" state.
 */
export default function IntegrationsConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const adaptersQ = useQuery({
    queryKey: ["console", "integrations", "adapters"],
    queryFn: api.integrations.adapters,
    enabled: hasServerAccess,
    retry: false,
  });

  const configsQ = useQuery({
    queryKey: ["console", "integrations", "configs"],
    queryFn: api.integrations.listConfigs,
    enabled: hasServerAccess,
    retry: false,
  });

  const rows = useMemo<AdapterRow[]>(() => {
    const configByAdapter = new Map((configsQ.data ?? []).map((c) => [c.adapterId, c]));
    return (adaptersQ.data ?? []).map((a) => {
      const cfg = configByAdapter.get(a.id);
      return { ...a, configured: cfg != null, enabled: cfg?.enabled ?? false };
    });
  }, [adaptersQ.data, configsQ.data]);

  const columns = useMemo<Column<AdapterRow>[]>(
    () => [
      {
        key: "adapter",
        header: t.console.colAdapter,
        sortValue: (r) => r.name,
        cell: (r) => <Bdi className="font-medium">{r.name}</Bdi>,
      },
      {
        key: "configured",
        header: t.console.colConfigured,
        sortValue: (r) => (r.configured ? 1 : 0),
        cell: (r) => (
          <Badge variant={r.configured ? "default" : "secondary"}>
            {r.configured ? t.console.valYes : t.console.valNo}
          </Badge>
        ),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (r) => (r.enabled ? 1 : 0),
        cell: (r) =>
          r.configured ? (
            <Badge variant={r.enabled ? "ok" : "secondary"}>
              {r.enabled ? t.console.valEnabled : t.console.valDisabled}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{t.console.dash}</span>
          ),
      },
      {
        key: "credentials",
        header: t.console.colCredentials,
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">
            {r.requiredCredentials.length ? r.requiredCredentials.join(", ") : t.console.dash}
          </span>
        ),
      },
    ],
    [],
  );

  const isLoading = adaptersQ.isLoading || configsQ.isLoading;
  const isError = adaptersQ.isError || configsQ.isError;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.integrations.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.integrations.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => {
              adaptersQ.refetch();
              configsQ.refetch();
            }}
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
