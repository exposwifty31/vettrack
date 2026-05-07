import { useEffect, useRef, useState } from "react";
import { useSyncQueue, useSync } from "@/hooks/use-sync";
import { Button } from "@/components/ui/button";
import {
  X,
  RefreshCw,
  CheckCircle2,
  Loader2,
  XCircle,
  Trash2,
  RotateCcw,
  CloudOff,
  ShieldAlert,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface SyncQueueSheetProps {
  open: boolean;
  onClose: () => void;
}

type SyncQueueData = ReturnType<typeof useSyncQueue>;
type SyncQueueItemModel = SyncQueueData["items"][number];
type SyncQueueItemType = SyncQueueItemModel["type"];

const TYPE_LABELS: Record<SyncQueueItemType, string> = {
  scan: t.syncQueueSheet.typeScan,
  seen: t.syncQueueSheet.typeSeen,
  create: t.syncQueueSheet.typeCreate,
  update: t.syncQueueSheet.typeUpdate,
  delete: t.syncQueueSheet.typeDelete,
  checkout: t.syncQueueSheet.typeCheckout,
  return: t.syncQueueSheet.typeReturn,
  return_with_charge: t.syncQueueSheet.typeReturn,
  restock: t.syncQueueSheet.typeRestock,
  shift_session: t.syncQueueSheet.typeShiftSession,
};

function extractEquipmentIdFromEndpoint(endpoint: string): string | null {
  const match = endpoint.match(/\/api\/equipment\/([^/]+)/);
  return match ? match[1] : null;
}

function getItemLabel(item: SyncQueueItemModel): string {
  if (item.equipmentName) return item.equipmentName;
  const id = extractEquipmentIdFromEndpoint(item.endpoint);
  if (id) return `ID: ${id.slice(0, 8)}…`;
  return t.syncQueueSheet.unknownEquipment;
}

function DiscardConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-xs text-red-700 flex-1">Remove this action from queue?</p>
      <Button
        size="sm"
        variant="outline"
        className="h-11 text-xs border-red-300 text-red-700 hover:bg-red-100"
        onClick={onConfirm}
      >
        Remove
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-11 text-xs"
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  );
}

function SyncQueueItem({
  item,
  onRetry,
  onDiscard,
}: {
  item: SyncQueueItemModel;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  const isPending = item.status === "pending";
  const isFailed = item.status === "failed";

  return (
    <div
      className={`rounded-xl border p-3 flex flex-col gap-1 ${
        isFailed
          ? "bg-red-50 border-red-200"
          : "bg-amber-50 border-amber-200"
      }`}
      data-testid={`sync-item-${item.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  isPending
                    ? "bg-amber-200 text-amber-800"
                    : "bg-red-200 text-red-800"
                }`}
              >
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                  isPending
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {isPending ? t.syncQueueSheet.pending : t.syncQueueSheet.failed}
              </span>
            </div>
            <p className="text-sm font-medium text-foreground truncate mt-0.5">
              {getItemLabel(item)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt))}
            </p>
          </div>
        </div>

        {isFailed && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-11 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-100"
              onClick={handleRetry}
              disabled={retrying}
              data-testid={`btn-retry-${item.id}`}
            >
              {retrying ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-11 w-11 p-0 text-red-500 hover:text-red-700 hover:bg-red-100"
              onClick={() => setConfirmDiscard(true)}
              data-testid={`btn-discard-${item.id}`}
              aria-label="Discard"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {isFailed && item.errorMessage && (
        <p className="text-xs text-red-600 mt-0.5 pl-5">{item.errorMessage}</p>
      )}

      {confirmDiscard && (
        <DiscardConfirm
          onConfirm={() => {
            setConfirmDiscard(false);
            onDiscard();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}

function CircuitBreakerBanner({ resetsAt }: { resetsAt: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsLeft = Math.max(0, Math.ceil((resetsAt - now) / 1000));

  return (
    <div className="flex items-start gap-2 px-5 py-3 bg-orange-50 border-b border-orange-200">
      <ShieldAlert className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-orange-800">Sync paused — too many errors</p>
        <p className="text-xs text-orange-700">
          {secsLeft > 0
            ? `Auto-resumes in ${secsLeft}s`
            : t.syncQueueSheet.resumingNow}
        </p>
      </div>
    </div>
  );
}

export function SyncQueueSheet({ open, onClose }: SyncQueueSheetProps) {
  const { items, pendingCount, failedCount, retry, discard } = useSyncQueue();
  const { isSyncing, triggerSync, isCircuitOpen, circuitResetsAt, batchCurrent, batchTotal } = useSync();
  const sheetRef = useRef<HTMLDivElement>(null);

  const totalCount = pendingCount + failedCount;

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="Sync Queue"
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white dark:bg-background rounded-t-2xl shadow-2xl max-h-[80vh]"
        data-testid="sync-queue-sheet"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <CloudOff className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="font-bold text-base leading-tight">Sync Queue</h2>
              <p className="text-xs text-muted-foreground">
                {isSyncing && batchTotal > 50
                  ? `Processing ${batchCurrent} of ${batchTotal}…`
                  : totalCount === 0
                  ? t.syncQueueSheet.allSynced
                  : `${totalCount} action${totalCount !== 1 ? "s" : ""} pending`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-11"
                onClick={triggerSync}
                disabled={isSyncing || isCircuitOpen}
                data-testid="btn-sync-now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? t.syncQueueSheet.syncingNow : t.syncQueueSheet.syncNow}
              </Button>
            )}
            <button
              onClick={onClose}
              className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
        {isCircuitOpen && <CircuitBreakerBanner resetsAt={circuitResetsAt} />}

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-safe flex flex-col gap-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">All synced</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No pending or failed actions
                </p>
              </div>
            </div>
          ) : (
            <>
              {failedCount > 0 && (
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">
                  {failedCount} Failed — action{failedCount !== 1 ? "s" : ""} need attention
                </p>
              )}
              {items.map((item) => (
                <SyncQueueItem
                  key={item.id}
                  item={item}
                  onRetry={() => retry(item.id!)}
                  onDiscard={() => discard(item.id!)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
