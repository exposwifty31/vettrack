import { useState, useEffect } from "react";
import {
  getConflictRows,
  offlineDb,
  updatePendingSync,
  type PendingSyncConflictPayload,
} from "@/lib/offline-db";

export type ConflictItem = {
  id: number;
  endpoint: string;
  method: string;
  serverData: unknown;
  localData: unknown;
};

let conflicts: ConflictItem[] = [];
const listeners: Set<() => void> = new Set();
let hydratePromise: Promise<void> | null = null;

function notify() {
  listeners?.forEach((fn) => fn());
}

function rowToConflictItem(row: {
  id?: number;
  endpoint: string;
  method: string;
  conflictPayload?: PendingSyncConflictPayload | null;
}): ConflictItem | null {
  if (row.id === undefined || !row.conflictPayload) return null;
  return {
    id: row.id,
    endpoint: row.endpoint,
    method: row.method,
    serverData: row.conflictPayload.serverData,
    localData: row.conflictPayload.localData,
  };
}

/** Load persisted conflicts from Dexie (survives full page reload). */
export async function hydrateConflictsFromDexie(): Promise<void> {
  const rows = await getConflictRows();
  conflicts = rows
    .map((row) => rowToConflictItem(row))
    .filter((item): item is ConflictItem => item !== null);
  notify();
}

export function ensureConflictsHydrated(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = hydrateConflictsFromDexie().catch(() => {
      hydratePromise = null;
    });
  }
  return hydratePromise;
}

export function addConflict(item: ConflictItem) {
  const existing = conflicts.some((c) => c.id === item.id);
  conflicts = existing
    ? conflicts.map((c) => (c.id === item.id ? item : c))
    : [...conflicts, item];
  notify();
}

export async function removeConflict(id: number): Promise<void> {
  conflicts = conflicts.filter((c) => c.id !== id);
  notify();
  try {
    await offlineDb.pendingSync.update(id, {
      conflictPayload: null,
      updatedAt: new Date(),
    });
  } catch {
    // Row may already be deleted via discard.
  }
}

export async function persistConflictPayload(
  id: number,
  payload: PendingSyncConflictPayload,
): Promise<void> {
  await updatePendingSync(id, {
    status: "conflict",
    conflictPayload: payload,
  });
  const row = await offlineDb.pendingSync.get(id);
  if (!row) return;
  const item = rowToConflictItem(row);
  if (item) addConflict(item);
}

export function useConflicts(): ConflictItem[] {
  const [state, setState] = useState<ConflictItem[]>(conflicts);
  useEffect(() => {
    void ensureConflictsHydrated();
    const handler = () => setState([...conflicts]);
    listeners?.add(handler);
    return () => {
      listeners?.delete(handler);
    };
  }, []);
  return state;
}
