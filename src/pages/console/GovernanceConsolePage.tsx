import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useExperience } from "@/hooks/use-experience";
import { DataTable, type Column } from "@/desktop/management";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Bdi } from "@/components/ui/bdi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  isValidStaleEvidenceMs,
  type EquipmentReadinessRulesV1,
} from "@/types";

const MS_PER_HOUR = 3_600_000;
const GOVERNANCE_KEY = ["console", "equipment-governance"] as const;

/** Per-type minimum row (minimumReadyByType is a Record<type, minimum>). */
type MinimumRow = { type: string; minimum: number };

/** Edit drawer — only `staleEvidenceMs` is editable in 7c v1 (entered in whole hours). */
function ReadinessEditSheet({ rules, onClose }: { rules: EquipmentReadinessRulesV1; onClose: () => void }) {
  const queryClient = useQueryClient();
  const initialHours = Math.round(rules.staleEvidenceMs / MS_PER_HOUR);
  const [hours, setHours] = useState<number>(initialHours);

  const nextMs = hours * MS_PER_HOUR;
  const valid = Number.isFinite(hours) && isValidStaleEvidenceMs(nextMs);

  const mut = useMutation({
    mutationFn: () => api.equipmentGovernance.updateReadinessRules({ staleEvidenceMs: nextMs }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GOVERNANCE_KEY });
      toast.success(t.console.governance.saved);
      onClose();
    },
    onError: () => toast.error(t.console.governance.saveFailed),
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>{t.console.governance.editTitle}</SheetTitle>
          <SheetDescription>{t.console.governance.staleEvidenceHelp}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="stale-hours">
              {t.console.governance.staleEvidenceLabel} ({t.console.governance.hoursLabel})
            </label>
            <Input
              id="stale-hours"
              type="number"
              min={1}
              value={Number.isFinite(hours) ? hours : ""}
              onChange={(e) => setHours(e.target.valueAsNumber)}
            />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !valid || nextMs === rules.staleEvidenceMs}>
            {t.console.governance.save}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Equipment Governance console (Phase 7c / B1). Surfaces the clinic's readiness
 * policy from the EXISTING `vt_equipment_readiness_config` row (no new table) and
 * allows a small guarded write of `staleEvidenceMs`. `minimumReadyByType` is shown
 * read-only in this slice. Reads are `requireAdmin`; a lead (management.web without
 * webWrite) sees the honest "pending server enablement" state.
 */
export default function GovernanceConsolePage() {
  const experience = useExperience();
  const hasServerAccess = experience.can("management.webWrite");
  const [editing, setEditing] = useState(false);

  const governanceQ = useQuery({
    queryKey: GOVERNANCE_KEY,
    queryFn: () => api.equipmentGovernance.getReadinessRules(),
    enabled: hasServerAccess,
    retry: false,
  });

  const rules = governanceQ.data?.rules;
  const minimumRows = useMemo<MinimumRow[]>(
    () =>
      Object.entries(rules?.minimumReadyByType ?? {})
        .map(([type, minimum]) => ({ type, minimum }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    [rules?.minimumReadyByType],
  );

  const minimumColumns = useMemo<Column<MinimumRow>[]>(
    () => [
      {
        key: "type",
        header: t.console.governance.colType,
        sortValue: (r) => r.type,
        cell: (r) => <Bdi className="font-medium">{r.type}</Bdi>,
      },
      {
        key: "minimum",
        header: t.console.governance.colMinimum,
        sortValue: (r) => r.minimum,
        cell: (r) => r.minimum,
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{t.console.governance.title}</h1>
          <p className="text-sm text-muted-foreground">{t.console.governance.subtitle}</p>
        </header>

        {!hasServerAccess ? (
          <EmptyState icon={ShieldCheck} message={t.console.accessPendingServer} />
        ) : governanceQ.isError ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">{t.console.state.error}</p>
            <Button variant="outline" className="mt-3" onClick={() => governanceQ.refetch()}>
              {t.console.retry}
            </Button>
          </div>
        ) : governanceQ.isLoading || !rules ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <section className="rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-foreground">
                    {t.console.governance.staleEvidenceLabel}
                  </h2>
                  <p className="text-2xl font-bold text-foreground">
                    {Math.round(rules.staleEvidenceMs / MS_PER_HOUR)} {t.console.governance.hoursLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.console.governance.staleEvidenceHelp}</p>
                  <p className="text-xs text-muted-foreground">
                    {governanceQ.data?.updatedAt
                      ? `${t.console.governance.lastUpdated} ${formatRelativeTime(new Date(governanceQ.data.updatedAt))}`
                      : t.console.governance.usingDefaults}
                  </p>
                </div>
                <Button onClick={() => setEditing(true)}>{t.console.governance.edit}</Button>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">{t.console.governance.minimumReadyTitle}</h2>
              {minimumRows.length ? (
                <DataTable
                  columns={minimumColumns}
                  rows={minimumRows}
                  rowKey={(r) => r.type}
                  emptyIcon={ShieldCheck}
                  emptyMessage={t.console.governance.minimumReadyEmpty}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t.console.governance.minimumReadyEmpty}</p>
              )}
            </section>
          </>
        )}
      </div>
      {editing && rules && <ReadinessEditSheet rules={rules} onClose={() => setEditing(false)} />}
    </AppShell>
  );
}
