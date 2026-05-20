import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { liveQuery } from "dexie";
import {
  offlineDb,
  updatePendingSync,
  removePendingSync,
  type PendingSync,
} from "@/lib/offline-db";
import { processQueue, onSyncStateChange, getSyncProgress, initSyncEngine } from "@/lib/sync-engine";

interface SyncState {
  pendingCount: number;
  failedCount: number;
  isSyncing: boolean;
  justSynced: boolean;
  recentItems: PendingSync[];
  items: PendingSync[];
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
  isSyncing: false,
  justSynced: false,
  recentItems: [],
  items: [],
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
  const failedCount = useMemo(() => allItems.filter((i) => i.status === "failed").length, [allItems]);
  const items = useMemo(() => allItems.filter((i) => i.status === "pending" || i.status === "failed"), [allItems]);
  const recentItems = useMemo(() => allItems.slice(-20), [allItems]);

  const applyAll = useCallback((all: PendingSync[]) => {
    const p = all.filter((i) => i.status === "pending").length;
    const f = all.filter((i) => i.status === "failed").length;

    if (prevPendingRef.current > 0 && p === 0 && f === 0) {
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
    await updatePendingSync(id, { status: "pending", retries: 0, errorMessage: undefined });
    processQueue().catch(() => {});
  }, []);

  const discard = useCallback(async (id: number) => {
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
      isSyncing,
      justSynced,
      recentItems,
      items,
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
  const { pendingCount, failedCount, items, retry, discard } = useContext(SyncContext);
  return { pendingCount, failedCount, items, retry, discard };
}
