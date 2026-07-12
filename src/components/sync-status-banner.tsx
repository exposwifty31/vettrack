import { useSync } from "@/hooks/use-sync";
import { AlertTriangle, CloudOff, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { t } from "@/lib/i18n";
import type { PendingSync } from "@/lib/offline-db";

/**
 * Picks the row that represents the CURRENT failure state: permanent
 * failures (dead-letter / conflict) outrank still-retrying ones, and within
 * a group the most recently updated row wins — that's the freshest failure
 * signature (T-36 · R-SY-02).
 */
function pickPrimaryFailingItem(
  deadLetterItems: PendingSync[],
  retryableFailedItems: PendingSync[],
): PendingSync | undefined {
  const byRecency = (a: PendingSync, b: PendingSync) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (deadLetterItems.length > 0) return [...deadLetterItems].sort(byRecency)[0];
  if (retryableFailedItems.length > 0) return [...retryableFailedItems].sort(byRecency)[0];
  return undefined;
}

/**
 * Failure signature the dismissal is keyed to: `(syncErrorKind,
 * targetResource)`. Two banner states share a signature iff BOTH fields are
 * equal — a distinct signature (e.g. a different, more serious failure)
 * must re-show the banner even though an earlier one was dismissed.
 */
function deriveDismissalSignature(params: {
  hasFailed: boolean;
  isCircuitOpen: boolean;
  hasPending: boolean;
  deadLetterItems: PendingSync[];
  retryableFailedItems: PendingSync[];
}): string {
  const { hasFailed, isCircuitOpen, hasPending, deadLetterItems, retryableFailedItems } = params;

  if (hasFailed) {
    const item = pickPrimaryFailingItem(deadLetterItems, retryableFailedItems);
    const syncErrorKind = item?.structuredError?.code ?? item?.errorMessage ?? "unknown_error";
    const targetResource = item?.endpoint ?? item?.type ?? "unknown_resource";
    return `${syncErrorKind}::${targetResource}`;
  }
  if (isCircuitOpen) return "circuit_open::queue";
  if (hasPending) return "pending::queue";
  return "none::none";
}

/**
 * Sticky banner shown when the offline sync queue has pending or failed items.
 * Failed items represent dispenses / scans that never reached the server —
 * i.e. guaranteed billing leakage. This banner surfaces that silently-failing
 * state and gives staff a one-tap path to retry or review.
 */
export function SyncStatusBanner() {
  const {
    pendingCount,
    failedCount,
    isSyncing,
    isCircuitOpen,
    triggerSync,
    deadLetterItems,
    retryableFailedItems,
  } = useSync();
  const [dismissedSignatures, setDismissedSignatures] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const hasFailed  = failedCount > 0;
  const hasPending = pendingCount > 0;

  const signature = deriveDismissalSignature({
    hasFailed,
    isCircuitOpen,
    hasPending,
    deadLetterItems,
    retryableFailedItems,
  });
  const isDismissed = dismissedSignatures.has(signature);

  if (isDismissed || (!hasFailed && !hasPending)) return null;

  const isFailing = hasFailed || isCircuitOpen;

  return (
    <div
      className={[
        "fixed bottom-nav-float inset-x-0 z-50 mx-4 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg sm:mx-auto sm:max-w-md",
        isFailing
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-400/30 bg-amber-50/90 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
      ].join(" ")}
      role="alert"
    >
      {isFailing ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <CloudOff className="h-4 w-4 shrink-0" />
      )}

      <p className="flex-1 text-xs font-medium">
        {hasFailed
          ? t.sync.status.failed(failedCount)
          : t.sync.status.pending(pendingCount)}
        {isCircuitOpen && " — sync paused, retrying soon"}
      </p>

      {!isCircuitOpen && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 shrink-0 px-2 text-xs"
          disabled={isSyncing}
          onClick={() => void triggerSync()}
        >
          <RefreshCw className={["h-3 w-3", isSyncing ? "animate-spin" : ""].join(" ")} />
          <span className="ms-1">{isSyncing ? t.sync.status.syncing : t.sync.action.retry}</span>
        </Button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        onClick={() =>
          setDismissedSignatures((prev) => {
            const next = new Set(prev);
            next.add(signature);
            return next;
          })
        }
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
