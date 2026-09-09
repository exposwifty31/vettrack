import { useMemo } from "react";
import { useLocation } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { DataTable, type Column } from "@/desktop/management/DataTable";
import { Badge } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { CriticalItem } from "@/lib/dashboard-utils";
import {
  isManagementRecoveryCriticalRow,
  type ManagementRecoveryCriticalRow,
} from "@/lib/management-dashboard-recovery";

type CriticalRow = CriticalItem | ManagementRecoveryCriticalRow;

/** Recovery rows carry an i18n key; legacy rows carry server free text. */
function reasonOf(item: CriticalRow): string {
  return isManagementRecoveryCriticalRow(item)
    ? t.managementDashboardPage[item.reasonKey]
    : item.reason;
}

function statusLabelOf(item: CriticalRow): string {
  if (isManagementRecoveryCriticalRow(item)) return t.managementDashboardPage[item.reasonKey];
  return item.status === "issue"
    ? t.managementDashboardPage.issue
    : t.managementDashboardPage.missing;
}

function statusVariantOf(item: CriticalRow): "outline" | "issue" | "maintenance" {
  if (isManagementRecoveryCriticalRow(item)) return "outline";
  return item.status === "issue" ? "issue" : "maintenance";
}

interface CriticalAlertsTableProps {
  items: CriticalRow[] | undefined;
  isLoading?: boolean;
}

/**
 * Dense desktop body for the `/dashboard` critical-alerts section (Track A). The
 * card row stack in `management-dashboard.tsx` is unchanged and still serves narrow
 * widths.
 *
 * Reason and status labelling go through the same `isManagementRecoveryCriticalRow`
 * discriminator the card rows use, so the two bodies cannot label a recovery row
 * differently.
 */
export function CriticalAlertsTable({ items, isLoading }: CriticalAlertsTableProps) {
  const [, navigate] = useLocation();

  const columns = useMemo<Column<CriticalRow>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (i) => i.name,
        cell: (i) => <Bdi className="font-semibold">{i.name}</Bdi>,
      },
      {
        key: "reason",
        header: t.console.colReason,
        sortValue: (i) => reasonOf(i),
        cell: (i) => <Bdi className="text-xs text-muted-foreground">{reasonOf(i)}</Bdi>,
      },
      {
        key: "location",
        header: t.console.colRoom,
        sortValue: (i) => i.location ?? "",
        cell: (i) => (i.location ? <Bdi>{i.location}</Bdi> : "—"),
      },
      {
        key: "status",
        header: t.console.colStatus,
        sortValue: (i) => statusLabelOf(i),
        cell: (i) => (
          <Badge variant={statusVariantOf(i)} className="px-2 py-0.5 text-[10px]">
            {statusLabelOf(i)}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(i) => i.id}
      rowTestId={(i) => `critical-row-${i.id}`}
      isLoading={isLoading}
      emptyIcon={CheckCircle2}
      emptyMessage={t.managementDashboardPage.allGood}
      onRowClick={(i) => navigate(`/equipment/${i.id}`)}
    />
  );
}
