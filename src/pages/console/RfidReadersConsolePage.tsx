import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RadioTower } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { formatRelativeTime } from "@/lib/relative-time";
import type { RfidReaderRow, RfidReaderStatus } from "@/types";

/** Status → badge label + variant. Read `t` lazily (reassignable on locale switch). */
function statusMeta(status: RfidReaderStatus): { label: string; variant: "ok" | "secondary" | "issue" } {
  switch (status) {
    case "online":
      return { label: t.console.readerOnline, variant: "ok" };
    case "stale":
      return { label: t.console.readerStale, variant: "issue" };
    case "no_signal":
      return { label: t.console.readerNoSignal, variant: "secondary" };
  }
}

/**
 * RFID Readers console (Phase 7c). There is no reader ENTITY server-side — the
 * registry is DERIVED from live signals (rooms.gatewayCode assignment + the
 * per-equipment doorway heartbeat) by `GET /api/admin/rfid-readers`. Read-only
 * observability: gateway, its room, heartbeat status, last-seen, observed count.
 * Reads are `requireAdmin`, so a lead sees the honest "pending server" state.
 */
export default function RfidReadersConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const readersQ = useQuery({
    queryKey: ["console", "rfid-readers"],
    queryFn: async () => (await api.rfidReaders.list()).readers,
    enabled: hasServerAccess,
    retry: false,
  });

  const columns = useMemo<Column<RfidReaderRow>[]>(
    () => [
      {
        key: "gateway",
        header: t.console.colGateway,
        sortValue: (r) => r.gatewayCode,
        cell: (r) => <span className="font-mono text-xs font-medium">{r.gatewayCode}</span>,
      },
      {
        key: "room",
        header: t.console.colRoom,
        sortValue: (r) => r.roomName ?? "",
        cell: (r) =>
          r.roomName ? (
            <Bdi>{r.roomName}</Bdi>
          ) : (
            <span className="text-muted-foreground">{t.console.readerUnassigned}</span>
          ),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (r) => r.status,
        cell: (r) => {
          const s = statusMeta(r.status);
          return <Badge variant={s.variant}>{s.label}</Badge>;
        },
      },
      {
        key: "lastSeen",
        header: t.console.colLastSeen,
        sortValue: (r) => r.lastSeenAt ?? "",
        cell: (r) =>
          r.lastSeenAt ? (
            formatRelativeTime(new Date(r.lastSeenAt))
          ) : (
            <span className="text-muted-foreground">{t.console.valNever}</span>
          ),
      },
      {
        key: "observed",
        header: t.console.colObserved,
        sortValue: (r) => r.observedEquipmentCount,
        cell: (r) => r.observedEquipmentCount,
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.rfidReaders.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.rfidReaders.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={readersQ.data}
            rowKey={(r) => r.gatewayCode}
            isLoading={readersQ.isLoading}
            isError={readersQ.isError}
            onRetry={() => readersQ.refetch()}
            emptyIcon={RadioTower}
            emptyMessage={t.console.state.empty}
          />
        ) : (
          <EmptyState icon={RadioTower} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
