import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/relative-time";
import { consoleStatusLabel } from "@/lib/console-status-label";
import type { NotificationDeliveryRow } from "@/types";

/** Channel → localized label. Read `t` lazily (reassignable on locale switch). */
function channelLabel(channel: NotificationDeliveryRow["channel"]): string {
  return channel === "push" ? t.console.channelPush : t.console.channelWhatsapp;
}

/**
 * Notifications console (Phase 7b). Read-only, clinic-scoped view over push
 * subscriptions + WhatsApp alerts (GET /api/admin/notifications). The recipient is
 * MASKED server-side — no raw push endpoints/keys, phone numbers, or message bodies
 * ever reach the client. No templates surface (deferred). Reads are requireAdmin, so
 * a lead sees the honest pending-server state.
 */
export default function NotificationsConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");

  const deliveriesQ = useQuery({
    queryKey: ["console", "notifications"],
    queryFn: async () => (await api.notifications.list()).deliveries,
    enabled: hasServerAccess,
    retry: false,
  });

  const columns = useMemo<Column<NotificationDeliveryRow>[]>(
    () => [
      {
        key: "channel",
        header: t.console.colChannel,
        sortValue: (r) => r.channel,
        cell: (r) => <Badge variant="secondary">{channelLabel(r.channel)}</Badge>,
      },
      {
        key: "target",
        header: t.console.colTarget,
        sortValue: (r) => r.maskedTarget,
        cell: (r) => <span className="font-mono text-xs">{r.maskedTarget}</span>,
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (r) => r.status,
        cell: (r) => consoleStatusLabel(r.status),
      },
      {
        key: "created",
        header: t.console.colOccurred,
        sortValue: (r) => r.createdAt,
        cell: (r) => formatRelativeTime(new Date(r.createdAt)),
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.notifications.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.notifications.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>
        {hasServerAccess ? (
          <DataTable
            columns={columns}
            rows={deliveriesQ.data}
            rowKey={(r) => `${r.channel}:${r.id}`}
            isLoading={deliveriesQ.isLoading}
            isError={deliveriesQ.isError}
            onRetry={() => deliveriesQ.refetch()}
            emptyIcon={BellRing}
            emptyMessage={t.console.state.empty}
          />
        ) : (
          <EmptyState icon={BellRing} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
