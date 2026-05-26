import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { liveQuery } from "dexie";
import {
  offlineDb,
  updatePendingSync,
  removePendingSync,
  type PendingSync,
} from "@/lib/offline-db";
import { removeConflict } from "@/lib/conflict-store";
import {
  filterPendingSyncRowsForEquipment,
  resolveLocalEntityState,
  type LocalEntityState,
} from "@/lib/local-entity-sync-state";
import { processQueue, onSyncStateChange, getSyncProgress, initSyncEngine } from "@/lib/sync-engine";

interface SyncState {
  pendingCount: number;
  failedCount: number;
  deadCount: number;
  conflictCount: number;
  isSyncing: boolean;
  justSynced: boolean;
  recentItems: PendingSync[];
  items: PendingSync[];
  pendingItems: PendingSync[];
  processingItems: PendingSync[];
  deadLetterItems: PendingSync[];
  retryableFailedItems: PendingSync[];
  isCircuitOpen: boolean;
  circuitResetsAt: number;
  batchCurrent: number;
  batchTotal: number;
  triggerSync: () => void;
  retry: (id: number) => Promise<void>;
  discard: (id: number) => Promise<void>;
}

const SyncContext = createContext<SyncState>({
  pendingCount: 0,
  failedCount: 0,
  deadCount: 0,
  conflictCount: 0,
  isSyncing: false,
  justSynced: false,
  recentItems: [],
  items: [],
  pendingItems: [],
  processingItems: [],
  deadLetterItems: [],
  retryableFailedItems: [],
  isCircuitOpen: false,
  circuitResetsAt: 0,
  batchCurrent: 0,
  batchTotal: 0,
  triggerSync: () => {},
  retry: async () => {},
  discard: async () => {},
});

export function SyncProvider({ children }: { children: ReactNode }) {
  const [allItems, setAllItems] = useState<PendingSync[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [isCircuitOpen, setIsCircuitOpen] = useState(false);
  const [circuitResetsAt, setCircuitResetsAt] = useState(0);
  const [batchCurrent, setBatchCurrent] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const prevPendingRef = useRef(0);
  const justSyncedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pendingCount = useMemo(() => allItems.filter((i) => i.status === "pending").length, [allItems]);
  const deadCount = useMemo(() => allItems.filter((i) => i.status === "dead").length, [allItems]);
  const conflictCount = useMemo(
    () => allItems.filter((i) => i.status === "conflict").length,
    [allItems],
  );
  const failedCount = useMemo(
    () =>
      allItems.filter((i) =>
        i.status === "failed" || i.status === "dead" || i.status === "conflict",
      ).length,
    [allItems],
  );
  const pendingItems = useMemo(
    () => allItems.filter((i) => i.status === "pending"),
    [allItems],
  );
  const processingItems = useMemo(
    () => allItems.filter((i) => i.status === "processing"),
    [allItems],
  );
  const deadLetterItems = useMemo(
    () => allItems.filter((i) => i.status === "dead" || i.status === "conflict"),
    [allItems],
  );
  const retryableFailedItems = useMemo(
    () => allItems.filter((i) => i.status === "failed"),
    [allItems],
  );
  const items = useMemo(
    () =>
      [...pendingItems, ...processingItems, ...deadLetterItems, ...retryableFailedItems].sort(
        (a, b) => {
          const at = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt);
          const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt);
          return at - bt;
        },
      ),
    [pendingItems, processingItems, deadLetterItems, retryableFailedItems],
  );
  const recentItems = useMemo(() => allItems.slice(-20), [allItems]);

  const applyAll = useCallback((all: PendingSync[]) => {
    const p = all.filter((i) => i.status === "pending").length;
    const processing = all.filter((i) => i.status === "processing").length;
    const f = all.filter((i) =>
      i.status === "failed" || i.status === "dead" || i.status === "conflict",
    ).length;

    if (prevPendingRef.current > 0 && p === 0 && processing === 0 && f === 0) {
      setJustSynced(true);
      if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
      justSyncedTimerRef.current = setTimeout(() => setJustSynced(false), 3000);
    }
    prevPendingRef.current = p;

    setAllItems((prev) => {
      const fingerprint = all.map((i) => `${i.id}:${i.status}`).join(",");
      const prevFingerprint = prev.map((i) => `${i.id}:${i.status}`).join(",");
      return fingerprint === prevFingerprint ? prev : all;
    });
  }, []);

  useEffect(() => {
    const observable = liveQuery(() =>
      offlineDb.pendingSync.orderBy("createdAt").toArray()
    );

    const subscription = observable.subscribe({
      next: (all) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => applyAll(all), 100);
      },
      error: () => {},
    });

    return () => {
      subscription.unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [applyAll]);

  useEffect(() => {
    const unsub = onSyncStateChange(() => {
      const progress = getSyncProgress();
      setIsSyncing(progress.isSyncing);
      setIsCircuitOpen(progress.isCircuitOpen);
      setCircuitResetsAt(progress.circuitResetsAt);
      setBatchCurrent(progress.batchCurrent);
      setBatchTotal(progress.batchTotal);
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    const cleanup = initSyncEngine();
    return cleanup;
  }, []);

  const triggerSync = useCallback(async () => {
    await processQueue();
  }, []);

  const retry = useCallback(async (id: number) => {
    await removeConflict(id);
    await updatePendingSync(id, {
      status: "pending",
      retries: 0,
      errorMessage: undefined,
      conflictPayload: null,
      structuredError: null,
    });
    processQueue().catch(() => {});
  }, []);

  const discard = useCallback(async (id: number) => {
    await removeConflict(id);
    await removePendingSync(id);
  }, []);

  useEffect(() => {
    return () => {
      if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
    };
  }, []);

  return (
    <SyncContext.Provider value={{
      pendingCount,
      failedCount,
      deadCount,
      conflictCount,
      isSyncing,
      justSynced,
      recentItems,
      items,
      pendingItems,
      processingItems,
      deadLetterItems,
      retryableFailedItems,
      isCircuitOpen,
      circuitResetsAt,
      batchCurrent,
      batchTotal,
      triggerSync,
      retry,
      discard,
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}

export function useSyncQueue() {
  const {
    pendingCount,
    failedCount,
    deadCount,
    conflictCount,
    items,
    pendingItems,
    processingItems,
    deadLetterItems,
    retryableFailedItems,
    retry,
    discard,
  } = useContext(SyncContext);
  return {
    pendingCount,
    failedCount,
    deadCount,
    conflictCount,
    items,
    pendingItems,
    processingItems,
    deadLetterItems,
    retryableFailedItems,
    retry,
    discard,
  };
}

/** Live queue rows + derived LocalEntityState for one equipment asset. */
export function usePendingSyncForEquipment(equipmentId: string | undefined): {
  rows: PendingSync[];
  localState: LocalEntityState;
} {
  const { items: allQueueItems } = useSync();
  return useMemo(() => {
    if (!equipmentId) {
      return { rows: [], localState: "synced" as const };
    }
    const rows = filterPendingSyncRowsForEquipment(equipmentId, allQueueItems);
    return {
      rows,
      localState: resolveLocalEntityState(equipmentId, allQueueItems),
    };
  }, [equipmentId, allQueueItems]);
}
