import { t, formatDateByLocale } from "@/lib/i18n";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BackChevron } from "@/components/ui/directional-chevron";
import type { InventoryItemDetail } from "@/types";

/**
 * Stage 5 — Inventory item detail (S5). Read-only aggregate view built from
 * real data: on-hand distribution across containers (vt_container_items) and
 * 7-day usage (vt_dispense_events). Par level / reorder are a follow-up that
 * requires new schema — intentionally not faked here.
 */
export default function InventoryItemDetailPage() {
  const p = t.inventoryItemDetailPage;
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const detailQ = useQuery({
    queryKey: ["inventory-item-detail", id],
    queryFn: () => api.inventoryItems.detail(id),
    enabled: !!id,
  });

  return (
    <AppShell>
      <Helmet>
        <title>{detailQ.data?.item.label ?? p.title} — VetTrack</title>
      </Helmet>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <button
          type="button"
          onClick={() => navigate("/inventory-items")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <BackChevron className="size-4" aria-hidden="true" />
          {p.back}
        </button>

        {detailQ.isPending ? (
          <LoadingState />
        ) : detailQ.isError ? (
          <ErrorCard message={p.loadError} onRetry={() => detailQ.refetch()} />
        ) : (
          <DetailBody detail={detailQ.data} />
        )}
      </div>
    </AppShell>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t.common.loading}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}

function DetailBody({ detail }: { detail: InventoryItemDetail }) {
  const p = t.inventoryItemDetailPage;
  const { item, onHandTotal, containers, usage7d, usage7dTotal } = detail;
  const maxUsage = Math.max(1, ...usage7d.map((u) => u.quantity));
  const { parLevel, reorderPoint } = item;
  const belowReorder = reorderPoint != null && onHandTotal <= reorderPoint;
  // Literal class strings (Tailwind JIT scans source statically — no interpolation).
  const stockColor =
    onHandTotal === 0
      ? "bg-[hsl(var(--status-issue))]"
      : belowReorder
        ? "bg-[hsl(var(--status-stale))]"
        : "bg-[hsl(var(--status-ok))]";
  const parFillPct =
    parLevel && parLevel > 0 ? Math.min(100, Math.round((onHandTotal / parLevel) * 100)) : 0;

  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: p.factCode, value: <span className="font-mono text-xs">{item.code}</span> },
    { label: p.factCategory, value: item.category ?? p.none },
    { label: p.factBillable, value: item.isBillable ? p.yes : p.no },
    { label: p.factMinCapture, value: item.minimumDispenseToCapture },
    { label: p.factNfc, value: item.nfcTagId ?? p.none },
    { label: p.factCreated, value: formatDateByLocale(item.createdAt, { dateStyle: "medium" }) },
  ];
  if (reorderPoint != null) {
    facts.splice(4, 0, { label: p.factReorderPoint, value: reorderPoint });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold leading-tight">{item.label}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
          {item.category && <Badge variant="secondary">{item.category}</Badge>}
        </div>
      </div>

      {/* On-hand hero (par-aware) */}
      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="flex items-baseline justify-between">
            <div className="flex flex-col">
              <span className="text-4xl font-bold tabular-nums">{onHandTotal}</span>
              <span className="text-sm text-muted-foreground">{p.onHand}</span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {parLevel != null && (
                <span className="text-sm text-muted-foreground tabular-nums">{p.parLabel(parLevel)}</span>
              )}
              <span className={`size-3 rounded-full ${stockColor}`} aria-hidden="true" />
            </div>
          </div>

          {parLevel != null && parLevel > 0 && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-active)]">
              <div
                className={`h-full rounded-full ${stockColor}`}
                style={{ width: `${parFillPct}%` }}
              />
            </div>
          )}

          {belowReorder && (
            <p className="rounded-lg bg-[var(--status-stale-bg)] px-3 py-2 text-sm text-[var(--status-stale-fg)]">
              {p.belowReorder(onHandTotal)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Two-column on wider viewports: usage + facts */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* 7-day usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{p.usageTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {usage7dTotal === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{p.usageEmpty}</p>
            ) : (
              <>
                <div className="flex justify-between gap-1.5 h-28">
                  {usage7d.map((point) => (
                    <div key={point.date} className="flex h-full flex-1 flex-col items-center gap-1.5">
                      <div className="flex w-full min-h-0 flex-1 items-end">
                        <div
                          className="w-full rounded-t-md bg-[hsl(var(--status-ok))]"
                          style={{ height: `${Math.max(4, (point.quantity / maxUsage) * 100)}%` }}
                          title={`${point.quantity}`}
                        />
                      </div>
                      <span className="text-[0.625rem] text-muted-foreground">
                        {formatDateByLocale(point.date, { weekday: "narrow" })}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{p.usageTotal(usage7dTotal)}</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Facts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{p.facts}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {facts.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="text-sm font-medium">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* In containers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{p.inContainers}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {containers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{p.containersEmpty}</p>
          ) : (
            <div className="divide-y">
              {containers.map((holding) => (
                <ListRow
                  key={holding.containerId}
                  leading={
                    <span
                      className="size-2 rounded-full bg-[hsl(var(--status-ok))]"
                      aria-hidden="true"
                    />
                  }
                  label={holding.containerName}
                  meta={<span className="tabular-nums font-medium">{holding.quantity}</span>}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
