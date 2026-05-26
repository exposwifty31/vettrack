import { useEffect, useRef, useState } from "react";
import { useSyncQueue, useSync } from "@/hooks/use-sync";
import { useAuth } from "@/hooks/use-auth";
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
  AlertTriangle,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { PendingSync } from "@/lib/offline-db";

interface SyncQueueSheetProps {
  open: boolean;
  onClose: () => void;
}

type SyncQueueItemModel = PendingSync;
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

function canManageQueueItem(
  item: SyncQueueItemModel,
  currentUserId: string | null,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (!item.userId || !currentUserId) return true;
  return item.userId === currentUserId;
}

function DiscardConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-xs font-semibold text-red-800">{t.syncQueueSheet.discardConfirmTitle}</p>
      <p className="text-xs text-red-700">{t.syncQueueSheet.discardConfirmBody}</p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-11 text-xs border-red-300 text-red-700 hover:bg-red-100"
          onClick={onConfirm}
        >
          {t.syncQueueSheet.discardConfirmAction}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 text-xs"
          onClick={onCancel}
        >
          {t.syncQueueSheet.discardConfirmCancel}
        </Button>
      </div>
    </div>
  );
}

function SyncQueueItem({
  item,
  canManage,
  onRetry,
  onDiscard,
  requireDiscardConfirm,
}: {
  item: SyncQueueItemModel;
  canManage: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  requireDiscardConfirm: boolean;
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
  const isProcessing = item.status === "processing";
  const isConflictStatus = item.status === "conflict";
  const isDead = item.status === "dead";
  const isRetryableFailed = item.status === "failed";
  const needsAttention =
    isConflictStatus || isDead || isRetryableFailed || (isPending && canManage);

  const statusLabel = isProcessing
    ? t.syncQueueSheet.statusProcessing
    : isPending
    ? t.syncQueueSheet.pending
    : isConflictStatus
    ? t.syncQueueSheet.statusConflict
    : isDead
    ? t.syncQueueSheet.statusDead
    : t.syncQueueSheet.failed;

  const statusColorClass = isPending || isProcessing
    ? "bg-amber-100 text-amber-700"
    : isConflictStatus
    ? "bg-orange-100 text-orange-700"
    : "bg-red-100 text-red-700";

  const cardColorClass = isPending || isProcessing
    ? "bg-amber-50 border-amber-200"
    : isConflictStatus
    ? "bg-orange-50 border-orange-200"
    : "bg-red-50 border-red-200";

  const iconNode = isPending || isProcessing ? (
    <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
  ) : isConflictStatus ? (
    <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" />
  ) : (
    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
  );

  const showActions = needsAttention && canManage && !isProcessing;

  return (
    <div
      className={`rounded-xl border p-3 flex flex-col gap-1 ${cardColorClass}`}
      data-testid={`sync-item-${item.id}`}
      data-sync-status={item.status}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {iconNode}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  isPending || isProcessing
                    ? "bg-amber-200 text-amber-800"
                    : isConflictStatus
                    ? "bg-orange-200 text-orange-800"
                    : "bg-red-200 text-red-800"
                }`}
              >
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColorClass}`}>
                {statusLabel}
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

        {showActions && (
          <div className="flex items-center gap-1.5 shrink-0">
            {!isPending && (
              <Button
                size="sm"
                variant="outline"
                className={`h-11 text-xs gap-1 ${
                  isConflictStatus
                    ? "border-orange-300 text-orange-700 hover:bg-orange-100"
                    : "border-amber-300 text-amber-700 hover:bg-amber-100"
                }`}
                onClick={handleRetry}
                disabled={retrying}
                data-testid={`btn-retry-${item.id}`}
              >
                {retrying ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                {t.sync.action.retry}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-11 w-11 p-0 text-red-500 hover:text-red-700 hover:bg-red-100"
              onClick={() => {
                if (requireDiscardConfirm) {
                  setConfirmDiscard(true);
                } else {
                  onDiscard();
                }
              }}
              data-testid={`btn-discard-${item.id}`}
              aria-label={t.syncQueueSheet.discardConfirmAction}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {!canManage && needsAttention && !isProcessing && (
        <p className="text-xs text-muted-foreground pl-5">{t.syncQueueSheet.discardNotAllowed}</p>
      )}

      {needsAttention && item.errorMessage && (
        <p className={`text-xs mt-0.5 pl-5 ${isConflictStatus ? "text-orange-700" : "text-red-600"}`}>
          {item.errorMessage}
        </p>
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

function SectionHeader({ children }: { children: string }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
      {children}
    </p>
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
        <p className="text-xs font-semibold text-orange-800">{t.syncQueueSheet.circuitPausedTitle}</p>
        <p className="text-xs text-orange-700">
          {secsLeft > 0
            ? t.syncQueueSheet.circuitPausedBody.replace("{seconds}", String(secsLeft))
            : t.syncQueueSheet.resumingNow}
        </p>
      </div>
    </div>
  );
}

export function SyncQueueSheet({ open, onClose }: SyncQueueSheetProps) {
  const {
    pendingCount,
    pendingItems,
    processingItems,
    deadLetterItems,
    retryableFailedItems,
    retry,
    discard,
  } = useSyncQueue();
  const { isSyncing, triggerSync, isCircuitOpen, circuitResetsAt, batchCurrent, batchTotal } = useSync();
  const { userId, isAdmin } = useAuth();
  const sheetRef = useRef<HTMLDivElement>(null);

  const totalCount =
    pendingCount +
    processingItems.length +
    deadLetterItems.length +
    retryableFailedItems.length;

  const hasQueueContent = totalCount > 0;

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  function renderItem(item: SyncQueueItemModel) {
    if (item.id === undefined) return null;
    const canManage = canManageQueueItem(item, userId, isAdmin);
    const requireDiscardConfirm =
      item.status === "dead" ||
      item.status === "conflict" ||
      item.status === "failed";

    return (
      <SyncQueueItem
        key={item.id}
        item={item}
        canManage={canManage}
        requireDiscardConfirm={requireDiscardConfirm}
        onRetry={() => retry(item.id!)}
        onDiscard={() => discard(item.id!)}
      />
    );
  }

  const subtitle = isSyncing && batchTotal > 50
    ? t.syncQueueSheet.subtitleProcessing
        .replace("{current}", String(batchCurrent))
        .replace("{total}", String(batchTotal))
    : totalCount === 0
    ? t.syncQueueSheet.allSynced
    : t.syncQueueSheet.subtitleActionsPending.replace("{count}", String(totalCount));

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[65]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.syncQueueSheet.title}
        className="fixed inset-x-0 bottom-0 z-[66] flex flex-col bg-white dark:bg-background rounded-t-2xl shadow-2xl max-h-[80vh]"
        data-testid="sync-queue-sheet"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <CloudOff className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="font-bold text-base leading-tight">{t.syncQueueSheet.title}</h2>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
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
              aria-label={t.syncQueueSheet.closeAria}
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
        {isCircuitOpen && <CircuitBreakerBanner resetsAt={circuitResetsAt} />}

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-safe flex flex-col gap-3">
          {!hasQueueContent ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">
                  {t.syncQueueSheet.emptyAllSyncedTitle}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.syncQueueSheet.emptyAllSyncedBody}
                </p>
              </div>
            </div>
          ) : (
            <>
              {(pendingItems.length > 0 || processingItems.length > 0) && (
                <>
                  <SectionHeader>{t.syncQueueSheet.pendingSection}</SectionHeader>
                  {processingItems.map(renderItem)}
                  {pendingItems.map(renderItem)}
                </>
              )}
              {deadLetterItems.length > 0 && (
                <>
                  <SectionHeader>{t.syncQueueSheet.deadLetterSection}</SectionHeader>
                  {deadLetterItems.map(renderItem)}
                </>
              )}
              {retryableFailedItems.length > 0 && (
                <>
                  <SectionHeader>{t.syncQueueSheet.failedSection}</SectionHeader>
                  {retryableFailedItems.map(renderItem)}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
