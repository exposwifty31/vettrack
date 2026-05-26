import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatDateByLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { OutboxHealthSnapshot } from "./outbox-dlq-types";

const DLQ_LIST_KEY = ["/api/admin/outbox/dlq"] as const;
const OUTBOX_HEALTH_KEY = ["/api/admin/outbox-health"] as const;

type DlqRow = {
  id: number;
  type: string;
  occurredAt: string;
  retryCount: number;
  errorType: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
};

function errorClassLabel(errorType: string | null): string {
  if (errorType === "permanent") return t.adminOpsDashboard.dlqErrorPermanent;
  if (errorType === "transient") return t.adminOpsDashboard.dlqErrorTransient;
  return t.adminOpsDashboard.dlqErrorUnclassified;
}

function formatTs(value: string | null): string {
  if (!value) return "—";
  return formatDateByLocale(value);
}

export function OutboxDlqPanel(props: { outboxHealth: OutboxHealthSnapshot | undefined }) {
  const { outboxHealth } = props;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [retryOpen, setRetryOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [forceRetry, setForceRetry] = useState(false);
  const [extraItems, setExtraItems] = useState<DlqRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);

  const dlqQ = useQuery({
    queryKey: [...DLQ_LIST_KEY, "initial"],
    queryFn: () => api.adminOutboxDlq.list(),
  });

  const items = useMemo(() => {
    const first = (dlqQ.data?.items ?? []) as DlqRow[];
    if (extraItems.length === 0) return first;
    const seen = new Set(first.map((r) => r.id));
    const merged = [...first];
    for (const row of extraItems) {
      if (!seen.has(row.id)) merged.push(row);
    }
    return merged;
  }, [dlqQ.data?.items, extraItems]);

  const invalidateOutbox = async () => {
    setSelected(new Set());
    setExtraItems([]);
    setNextCursor(undefined);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: DLQ_LIST_KEY }),
      queryClient.invalidateQueries({ queryKey: OUTBOX_HEALTH_KEY }),
    ]);
  };

  const retryMut = useMutation({
    mutationFn: (force: boolean) => api.adminOutboxDlq.retryAll(force ? { force: true } : {}),
    onSuccess: async (data) => {
      toast.success(t.adminOpsDashboard.dlqRetrySuccess.replace("{count}", String(data.resetCount)));
      setRetryOpen(false);
      setForceRetry(false);
      await invalidateOutbox();
    },
    onError: (err: Error) => {
      toast.error(err.message || t.adminOpsDashboard.dlqRetryFailed);
    },
  });

  const dropMut = useMutation({
    mutationFn: (ids: number[]) => api.adminOutboxDlq.drop(ids),
    onSuccess: async (data) => {
      toast.success(
        t.adminOpsDashboard.dlqDropSuccess.replace("{count}", String(data.deletedCount)),
      );
      setDropOpen(false);
      await invalidateOutbox();
    },
    onError: (err: Error) => {
      toast.error(err.message || t.adminOpsDashboard.dlqDropFailed);
    },
  });

  const loadMoreMut = useMutation({
    mutationFn: async () => {
      const cursor = nextCursor ?? dlqQ.data?.nextCursor;
      if (cursor == null) return null;
      return api.adminOutboxDlq.list({ cursor });
    },
    onSuccess: (page) => {
      if (!page) return;
      setExtraItems((prev) => [...prev, ...(page.items as DlqRow[])]);
      setNextCursor(page.nextCursor);
    },
  });

  const permanentCount = outboxHealth?.dlq_permanent_count ?? 0;
  const showForceCheckbox = permanentCount > 0;
  const canRetry = !showForceCheckbox || forceRetry;
  const selectedIds = [...selected];
  const hasMore = (nextCursor ?? dlqQ.data?.nextCursor) != null;

  const toggleRow = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(items.map((r) => r.id)));
  };

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-lg">{t.adminOpsDashboard.dlqSectionTitle}</CardTitle>
        <CardDescription>{t.adminOpsDashboard.dlqSectionSubtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={items.length === 0 || retryMut.isPending}
            onClick={() => {
              setForceRetry(false);
              setRetryOpen(true);
            }}
          >
            {t.adminOpsDashboard.dlqRetryAll}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedIds.length === 0 || dropMut.isPending}
            onClick={() => setDropOpen(true)}
          >
            {t.adminOpsDashboard.dlqDropSelected}
          </Button>
        </div>

        {dlqQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : dlqQ.isError ? (
          <p className="text-sm text-destructive">
            {(dlqQ.error as Error)?.message ?? t.adminOpsDashboard.dlqLoadFailed}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.adminOpsDashboard.dlqEmpty}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label={t.adminOpsDashboard.dlqSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">{t.adminOpsDashboard.dlqColId}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.adminOpsDashboard.dlqColType}</th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {t.adminOpsDashboard.dlqColErrorClass}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {t.adminOpsDashboard.dlqColRetries}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {t.adminOpsDashboard.dlqColLastAttempt}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {t.adminOpsDashboard.dlqColOccurred}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((row) => (
                  <tr key={row.id} className={cn(selected.has(row.id) && "bg-muted/30")}>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={(v) => toggleRow(row.id, v === true)}
                        aria-label={t.adminOpsDashboard.dlqSelectRow}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">{row.id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.type}</td>
                    <td className="px-3 py-2">{errorClassLabel(row.errorType)}</td>
                    <td className="px-3 py-2 tabular-nums">{row.retryCount}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatTs(row.lastAttemptAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatTs(row.occurredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            disabled={loadMoreMut.isPending}
            onClick={() => loadMoreMut.mutate()}
          >
            {loadMoreMut.isPending
              ? t.adminOpsDashboard.dlqLoadingMore
              : t.adminOpsDashboard.dlqLoadMore}
          </Button>
        )}

        <AlertDialog open={retryOpen} onOpenChange={setRetryOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.adminOpsDashboard.dlqRetryConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.adminOpsDashboard.dlqRetryConfirmDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {showForceCheckbox && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <Checkbox
                  id="dlq-force-retry"
                  checked={forceRetry}
                  onCheckedChange={(v) => setForceRetry(v === true)}
                />
                <Label htmlFor="dlq-force-retry" className="cursor-pointer text-sm leading-snug">
                  {t.adminOpsDashboard.dlqForceRetryLabel.replace(
                    "{count}",
                    String(permanentCount),
                  )}
                </Label>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{t.adminOpsDashboard.dlqCancel}</AlertDialogCancel>
              <AlertDialogAction
                disabled={!canRetry || retryMut.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  retryMut.mutate(forceRetry);
                }}
              >
                {t.adminOpsDashboard.dlqRetryConfirmAction}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={dropOpen} onOpenChange={setDropOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.adminOpsDashboard.dlqDropConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.adminOpsDashboard.dlqDropConfirmDescription.replace(
                  "{count}",
                  String(selectedIds.length),
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.adminOpsDashboard.dlqCancel}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={dropMut.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  dropMut.mutate(selectedIds);
                }}
              >
                {t.adminOpsDashboard.dlqDropConfirmAction}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
