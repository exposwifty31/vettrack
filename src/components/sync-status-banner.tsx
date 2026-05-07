import { useSync } from "@/hooks/use-sync";
import { AlertTriangle, CloudOff, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

/**
 * Sticky banner shown when the offline sync queue has pending or failed items.
 * Failed items represent dispenses / scans that never reached the server —
 * i.e. guaranteed billing leakage. This banner surfaces that silently-failing
 * state and gives staff a one-tap path to retry or review.
 */
export function SyncStatusBanner() {
  const { pendingCount, failedCount, isSyncing, isCircuitOpen, triggerSync } = useSync();
  const [dismissed, setDismissed] = useState(false);

  const hasFailed  = failedCount > 0;
  const hasPending = pendingCount > 0;

  if (dismissed || (!hasFailed && !hasPending)) return null;

  const isFailing = hasFailed || isCircuitOpen;

  return (
    <div
      className={[
        "fixed bottom-nav-float left-0 right-0 z-50 mx-4 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg sm:mx-auto sm:max-w-md",
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
          ? `${failedCount} item${failedCount !== 1 ? "s" : ""} failed to sync`
          : `${pendingCount} item${pendingCount !== 1 ? "s" : ""} pending sync`}
        {isCircuitOpen && " — sync paused, retrying soon"}
      </p>

      {!isCircuitOpen && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          disabled={isSyncing}
          onClick={() => void triggerSync()}
        >
          <RefreshCw className={["h-3 w-3", isSyncing ? "animate-spin" : ""].join(" ")} />
          <span className="ml-1">{isSyncing ? "Syncing" : "Retry"}</span>
        </Button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        onClick={() => setDismissed(true)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
