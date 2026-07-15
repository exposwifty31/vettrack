import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Bdi } from "@/components/ui/bdi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import type { DockingReconciliationBucketItem, ReconciliationBucket } from "@/types";

const EMPTY_DASH = "—";

/** Stable render order for all 8 buckets — mirrors the type union (design §6.2). */
export const RECONCILIATION_BUCKET_ORDER: ReconciliationBucket[] = [
  "at_home",
  "checked_out",
  "returned_unverified",
  "returned_away",
  "misplaced_at_station",
  "missing",
  "unassigned",
  "no_station",
];

/** The 4 operational drift buckets get their own worklist section (§6.1). */
export const DRIFT_BUCKET_ORDER: Array<"returned_unverified" | "returned_away" | "misplaced_at_station" | "missing"> = [
  "returned_unverified",
  "returned_away",
  "misplaced_at_station",
  "missing",
];

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// §6.1 severity mapping: accounted-for buckets read green, actionable drift
// reads red/amber by risk, and the setup-completeness buckets (unassigned /
// no_station — already actioned by their own sections on this page) read
// neutral rather than alarming.
const BUCKET_BADGE_VARIANT: Record<ReconciliationBucket, BadgeVariant> = {
  at_home: "ok",
  checked_out: "ok",
  returned_unverified: "maintenance",
  returned_away: "issue",
  misplaced_at_station: "maintenance",
  missing: "issue",
  unassigned: "secondary",
  no_station: "secondary",
};

export function bucketBadgeVariant(bucket: ReconciliationBucket): BadgeVariant {
  return BUCKET_BADGE_VARIANT[bucket];
}

export function bucketLabel(bucket: ReconciliationBucket): string {
  return t.adminHomeAssignment.bucketLabels[bucket];
}

interface BucketCountsSummaryProps {
  counts: Partial<Record<ReconciliationBucket, number>> | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/** All 8 buckets as compact stat chips — the top-of-page reconciliation overview (§6.1). */
export function BucketCountsSummary({ counts, isLoading, isError, onRetry }: BucketCountsSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.adminHomeAssignment.bucketCountsTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorCard message={t.adminHomeAssignment.reconciliationLoadError} onRetry={onRetry} />
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="reconciliation-bucket-counts">
            {RECONCILIATION_BUCKET_ORDER.map((bucket) => (
              <div
                key={bucket}
                data-testid={`bucket-count-${bucket}`}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1"
              >
                <Badge variant={bucketBadgeVariant(bucket)} className="px-1.5 py-0 text-[10px] tabular-nums">
                  {isLoading ? "…" : (counts?.[bucket] ?? 0)}
                </Badge>
                <span className="text-xs text-muted-foreground">{bucketLabel(bucket)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface DriftBucketSectionProps {
  bucket: (typeof DRIFT_BUCKET_ORDER)[number];
  items: DockingReconciliationBucketItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * A single operational-drift bucket's worklist — read-focused (the manager
 * investigates/locates, no one-tap resolution here). Per-item audit row:
 * name · home dock · bucket badge · holder when relevant (§6.1); holder is
 * expected to be absent for these 4 buckets since checked_out short-circuits
 * the classifier first (D-9), but the row still renders it if ever present.
 */
export function DriftBucketSection({ bucket, items, isLoading, isError, onRetry }: DriftBucketSectionProps) {
  const copy = t.adminHomeAssignment.driftBuckets[bucket];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge variant={bucketBadgeVariant(bucket)}>{bucketLabel(bucket)}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </CardHeader>
      <CardContent className="space-y-1.5" data-testid={`reconciliation-section-${bucket}`}>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <ErrorCard message={t.adminHomeAssignment.reconciliationLoadError} onRetry={onRetry} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              data-testid={`reconciliation-item-${item.id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 border rounded text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  <Bdi>{item.name}</Bdi>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <Bdi>{item.homeDockName ?? EMPTY_DASH}</Bdi>
                  {item.checkedOutByEmail && (
                    <>
                      {" · "}
                      <Bdi>{t.adminHomeAssignment.holderLabel(item.checkedOutByEmail)}</Bdi>
                    </>
                  )}
                </p>
              </div>
              <Badge variant={bucketBadgeVariant(item.bucket)} className="shrink-0">
                {bucketLabel(item.bucket)}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
