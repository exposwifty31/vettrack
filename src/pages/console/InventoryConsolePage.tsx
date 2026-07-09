import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, ReadOnlyChip, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
import type { PurchaseOrder, RestockSessionRow, LowStockRow } from "@/types";

type Tab = "po" | "restock" | "lowstock";

/**
 * Inventory console (Phase 7d). Read-only, clinic-scoped oversight across three tabs:
 * purchase orders (existing GET /api/procurement), restock sessions (B3), and low-stock
 * items (B4). Each tab loads lazily when selected. management.webWrite gates the read;
 * a lead sees the honest pending-server state. Write actions are out of scope for v1.
 */
export default function InventoryConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");
  const [tab, setTab] = useState<Tab>("po");

  const poQ = useQuery({
    queryKey: ["console", "inventory", "po"],
    queryFn: () => api.procurement.list(),
    enabled: hasServerAccess && tab === "po",
    retry: false,
  });
  const restockQ = useQuery({
    queryKey: ["console", "inventory", "restock"],
    queryFn: async () => (await api.restock.sessions()).sessions,
    enabled: hasServerAccess && tab === "restock",
    retry: false,
  });
  const lowStockQ = useQuery({
    queryKey: ["console", "inventory", "lowstock"],
    queryFn: async () => (await api.inventoryItems.lowStock()).items,
    enabled: hasServerAccess && tab === "lowstock",
    retry: false,
  });

  const poColumns = useMemo<Column<PurchaseOrder>[]>(
    () => [
      { key: "supplier", header: t.console.inventory.colSupplier, sortValue: (r) => r.supplierName, cell: (r) => <Bdi className="font-medium">{r.supplierName}</Bdi> },
      { key: "status", header: t.console.colStatus, sortValue: (r) => r.status, cell: (r) => <Badge variant="secondary">{r.status}</Badge> },
      { key: "created", header: t.console.colOccurred, sortValue: (r) => r.createdAt, cell: (r) => formatRelativeTime(new Date(r.createdAt)) },
    ],
    [],
  );

  const restockColumns = useMemo<Column<RestockSessionRow>[]>(
    () => [
      { key: "container", header: t.console.inventory.colContainer, sortValue: (r) => r.containerName, cell: (r) => <Bdi className="font-medium">{r.containerName}</Bdi> },
      { key: "status", header: t.console.colStatus, sortValue: (r) => r.status, cell: (r) => <Badge variant="secondary">{r.status}</Badge> },
      { key: "started", header: t.console.inventory.colStarted, sortValue: (r) => r.startedAt, cell: (r) => formatRelativeTime(new Date(r.startedAt)) },
      { key: "finished", header: t.console.inventory.colFinished, sortValue: (r) => r.finishedAt ?? "", cell: (r) => (r.finishedAt ? formatRelativeTime(new Date(r.finishedAt)) : <span className="text-muted-foreground">{t.console.dash}</span>) },
    ],
    [],
  );

  const lowStockColumns = useMemo<Column<LowStockRow>[]>(
    () => [
      { key: "item", header: t.console.inventory.colItem, sortValue: (r) => r.label, cell: (r) => <Bdi className="font-medium">{r.label}</Bdi> },
      { key: "par", header: t.console.inventory.colPar, sortValue: (r) => r.parLevel, cell: (r) => r.parLevel },
      { key: "onHand", header: t.console.inventory.colOnHand, sortValue: (r) => r.onHand, cell: (r) => r.onHand },
      { key: "short", header: t.console.inventory.colShort, sortValue: (r) => r.short, cell: (r) => <Badge variant="issue">{r.short}</Badge> },
    ],
    [],
  );

  const TABS: { key: Tab; label: string }[] = [
    { key: "po", label: t.console.inventory.tabPurchaseOrders },
    { key: "restock", label: t.console.inventory.tabRestock },
    { key: "lowstock", label: t.console.inventory.tabLowStock },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{t.console.inventory.title}</h1>
            <p className="text-sm text-muted-foreground">{t.console.inventory.subtitle}</p>
          </div>
          <ReadOnlyChip />
        </header>

        {hasServerAccess ? (
          <>
            <div role="tablist" className="inline-flex rounded-lg border border-border p-1">
              {TABS.map((tb) => (
                <button
                  key={tb.key}
                  role="tab"
                  aria-selected={tab === tb.key}
                  onClick={() => setTab(tb.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    tab === tb.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tb.label}
                </button>
              ))}
            </div>

            {tab === "po" && (
              <DataTable columns={poColumns} rows={poQ.data} rowKey={(r) => r.id} isLoading={poQ.isLoading} isError={poQ.isError} onRetry={() => poQ.refetch()} emptyIcon={Package} emptyMessage={t.console.state.empty} />
            )}
            {tab === "restock" && (
              <DataTable columns={restockColumns} rows={restockQ.data} rowKey={(r) => r.id} isLoading={restockQ.isLoading} isError={restockQ.isError} onRetry={() => restockQ.refetch()} emptyIcon={Package} emptyMessage={t.console.state.empty} />
            )}
            {tab === "lowstock" && (
              <DataTable columns={lowStockColumns} rows={lowStockQ.data} rowKey={(r) => r.itemId} isLoading={lowStockQ.isLoading} isError={lowStockQ.isError} onRetry={() => lowStockQ.refetch()} emptyIcon={Package} emptyMessage={t.console.state.empty} />
            )}
          </>
        ) : (
          <EmptyState icon={Package} message={t.console.accessPendingServer} />
        )}
      </div>
    </AppShell>
  );
}
