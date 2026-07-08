import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { Button } from "@/components/ui/button";
import type { AuditLog } from "@/types";

/**
 * Audit Log console (Phase 7e). A read-only, server-paginated view over the
 * existing `GET /api/audit-logs` (requireAdmin, clinic-scoped). Action labels come
 * from `t.auditLog.actionLabel` — the real localized labels over the closed
 * AuditActionType union; this page never invents action kinds. Reads are
 * requireAdmin, so a lead (management.web, no webWrite) sees the pending state.
 */
export default function AuditConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");
  const [page, setPage] = useState(1);

  const auditQ = useQuery({
    queryKey: ["console", "audit-log", page],
    queryFn: () => api.auditLogs.list({ page }),
    enabled: hasServerAccess,
    retry: false,
  });

  const rows = auditQ.data?.items ?? [];
  const hasMore = auditQ.data?.hasMore ?? false;

  const columns = useMemo<Column<AuditLog>[]>(
    () => [
      {
        key: "time",
        header: t.console.audit.colTimestamp,
        sortValue: (r) => r.timestamp,
        cell: (r) => <span className="text-xs text-muted-foreground">{new Date(r.timestamp).toLocaleString()}</span>,
      },
      {
        key: "action",
        header: t.console.audit.colAction,
        sortValue: (r) => r.actionType,
        cell: (r) => <Badge variant="secondary">{t.auditLog.actionLabel(r.actionType)}</Badge>,
      },
      {
        key: "actor",
        header: t.console.audit.colActor,
        sortValue: (r) => r.performedByName || r.performedByEmail,
        cell: (r) => (
          <Bdi>{(r.performedByName && r.performedByName.trim()) || r.performedByEmail || t.common.unknown}</Bdi>
        ),
      },
      {
        key: "target",
        header: t.console.audit.colTarget,
        sortValue: (r) => r.targetType ?? "",
        cell: (r) =>
          r.targetType ? (
            <span className="text-xs">
              {r.targetType}
              {r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}
            </span>
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
            <h1 className="text-2xl font-bold text-foreground">{t.console.audit.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.audit.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>
        {hasServerAccess ? (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              isLoading={auditQ.isLoading}
              isError={auditQ.isError}
              onRetry={() => auditQ.refetch()}
              emptyIcon={ScrollText}
              emptyMessage={t.console.state.empty}
            />
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || auditQ.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t.console.pagination.previous}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t.console.pagination.page} {page}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore || auditQ.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                {t.console.pagination.next}
              </Button>
            </div>
          </>
        ) : (
          <EmptyState icon={ScrollText} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
