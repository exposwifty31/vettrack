import Dexie, { type Table } from "dexie";
import type { QueryClient } from "@tanstack/react-query";
import type { Equipment, ScanLog, Folder, Room } from "@/types";
import { assertPendingSyncEnqueueAllowed } from "@/lib/offline-policy";
import { getCurrentClinicId, getCurrentUserId } from "@/lib/auth-store";

/** Phase 5 queue state machine — see docs/offline-first-architecture-plan.md § Phase 5. */
export type PendingSyncStatus =
  | "pending"
  | "processing"
  | "synced"
  | "failed"
  | "dead"
  | "conflict";

/** Must match `MAX_RETRIES` in sync-engine.ts (replay retry budget). */
export const PENDING_SYNC_MAX_RETRIES = 5;

/** Terminal `dead` rows older than this may be purged on startup (never `conflict`). */
export const DEAD_LETTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const PERMANENT_FAILURE_MESSAGE = `Failed after ${PENDING_SYNC_MAX_RETRIES} attempts`;

export interface PendingSyncConflictPayload {
  serverData: unknown;
  localData: unknown;
  capturedAt: number;
}
export type PendingSyncType =
  | "scan"
  | "seen"
  | "create"
  | "update"
  | "delete"
  | "checkout"
  | "return"
  | "return_with_charge";

/** Current Dexie pendingSync row schema version (queue evolution). */
export const PENDING_SYNC_SCHEMA_VERSION = 2;

export type PendingSyncStructuredErrorDetails = Record<
  string,
  string | number | boolean | null
>;

export interface PendingSyncStructuredError {
  code: string;
  message?: string;
  details?: PendingSyncStructuredErrorDetails;
}

export interface PendingSync {
  id?: number;
  type: PendingSyncType;
  endpoint: string;
  method: string;
  body: string;
  createdAt: Date;
  retries: number;
  status: PendingSyncStatus;
  clientTimestamp: number;
  clientMutationId: string;
  idempotencyKey: string;
  schemaVersion: number;
  updatedAt: Date;
  structuredError: PendingSyncStructuredError | null;
  clinicId?: string;
  userId?: string;
  optimisticData?: string;
  errorMessage?: string;
  equipmentName?: string;
  /** Set when status is `conflict` (409 OCC); survives reload. */
  conflictPayload?: PendingSyncConflictPayload | null;
}

/** Fields auto-filled at enqueue; callers omit these unless overriding clinicId/userId. */
export type PendingSyncCreateInput = Omit<
  PendingSync,
  | "id"
  | "clientMutationId"
  | "idempotencyKey"
  | "schemaVersion"
  | "updatedAt"
  | "structuredError"
  | "clinicId"
  | "userId"
> & {
  clinicId?: string;
  userId?: string;
};

const PENDING_SYNC_STORES =
  "++id, type, createdAt, status, clientTimestamp" as const;

function newQueueUuid(): string {
  return crypto.randomUUID();
}

function coerceDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) return value;
  if (value !== undefined) return new Date(value);
  return new Date();
}

/**
 * Backfill Phase 3 fields on an existing row (migration-safe, idempotent).
 */
export function applyPendingSyncSchemaDefaults(row: PendingSync): void {
  if (!row.clientMutationId) {
    row.clientMutationId = newQueueUuid();
  }
  if (!row.idempotencyKey) {
    row.idempotencyKey = newQueueUuid();
  }
  if (row.schemaVersion == null) {
    row.schemaVersion = PENDING_SYNC_SCHEMA_VERSION;
  }
  if (!row.updatedAt) {
    row.updatedAt = coerceDate(row.createdAt);
  }
  if (row.structuredError === undefined) {
    row.structuredError = null;
  }
  if (row.conflictPayload === undefined) {
    row.conflictPayload = null;
  }
}

function isLegacyTerminalFailedRow(row: PendingSync): boolean {
  if (row.status !== "failed") return false;
  if ((row.retries ?? 0) >= PENDING_SYNC_MAX_RETRIES) return true;
  const msg = row.errorMessage?.trim() ?? "";
  if (msg === PERMANENT_FAILURE_MESSAGE) return true;
  if (/failed after \d+ attempts/i.test(msg)) return true;
  return false;
}

function isLegacyConflictFailedRow(row: PendingSync): boolean {
  if (row.status !== "failed") return false;
  const msg = row.errorMessage?.toLowerCase() ?? "";
  if (msg.includes("conflict")) return true;
  const code = row.structuredError?.code?.toLowerCase() ?? "";
  return code.includes("conflict");
}

function backfillConflictPayloadFromLegacyRow(
  row: PendingSync,
): PendingSyncConflictPayload | null {
  if (row.conflictPayload) return row.conflictPayload;
  try {
    const localData = JSON.parse(row.body || "{}");
    return {
      serverData: row.structuredError?.details ?? null,
      localData,
      capturedAt: row.updatedAt?.getTime?.() ?? Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Phase 5 migration: terminal legacy `failed` → `dead` or `conflict`; schema v2 defaults.
 */
export async function upgradePendingSyncPhase5(
  table: Table<PendingSync, number>,
): Promise<void> {
  await table.toCollection().modify((row) => {
    applyPendingSyncSchemaDefaults(row);
    if (row.status === "processing") {
      row.status = "pending";
    }
    if (isLegacyConflictFailedRow(row)) {
      row.status = "conflict";
      row.conflictPayload = backfillConflictPayloadFromLegacyRow(row);
      return;
    }
    if (isLegacyTerminalFailedRow(row)) {
      row.status = "dead";
    }
  });
}

export async function upgradePendingSyncTable(
  table: Table<PendingSync, number>,
): Promise<void> {
  await table.toCollection().modify((row) => {
    applyPendingSyncSchemaDefaults(row);
  });
}

function getPendingSyncEnqueueContext(): { clinicId?: string; userId?: string } {
  const userId = getCurrentUserId()?.trim();
  const clinicId = getCurrentClinicId()?.trim();
  return {
    userId: userId || undefined,
    clinicId: clinicId || undefined,
  };
}

function materializePendingSyncRow(op: PendingSyncCreateInput): Omit<PendingSync, "id"> {
  const ctx = getPendingSyncEnqueueContext();
  const now = new Date();
  return {
    ...op,
    clinicId: op.clinicId ?? ctx.clinicId,
    userId: op.userId ?? ctx.userId,
    clientMutationId: newQueueUuid(),
    idempotencyKey: newQueueUuid(),
    schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
    updatedAt: now,
    structuredError: null,
    conflictPayload: null,
  };
}

class VetTrackDB extends Dexie {
  equipment!: Table<Equipment>;
  scanLogs!: Table<ScanLog>;
  folders!: Table<Folder>;
  rooms!: Table<Room>;
  pendingSync!: Table<PendingSync>;

  constructor() {
    super("vettrack");
    this.version(3).stores({
      equipment: "id, name, status, folderId, lastSeen, createdAt",
      scanLogs: "id, equipmentId, timestamp",
      folders: "id, name, type",
      pendingSync: PENDING_SYNC_STORES,
    });
    this.version(4).stores({
      equipment: "id, name, status, folderId, roomId, location, lastSeen, createdAt",
      scanLogs: "id, equipmentId, timestamp",
      folders: "id, name, type",
      rooms: "id, name, syncStatus",
      pendingSync: PENDING_SYNC_STORES,
    });
    this.version(5).stores({
      equipment: "id, name, status, folderId, roomId, location, lastSeen, createdAt",
      scanLogs: "id, equipmentId, timestamp",
      folders: "id, name, type",
      rooms: "id, name, syncStatus",
      pendingSync: PENDING_SYNC_STORES,
    }).upgrade(async (tx) => {
      await upgradePendingSyncTable(tx.table("pendingSync"));
    });
    this.version(6).stores({
      equipment: "id, name, status, folderId, roomId, location, lastSeen, createdAt",
      scanLogs: "id, equipmentId, timestamp",
      folders: "id, name, type",
      rooms: "id, name, syncStatus",
      pendingSync: PENDING_SYNC_STORES,
    }).upgrade(async (tx) => {
      await upgradePendingSyncPhase5(tx.table("pendingSync"));
    });
  }
}

export const offlineDb = new VetTrackDB();

function getPendingSyncTable(): Table<PendingSync, number> | null {
  // Resolve the table from Dexie's runtime registry instead of relying on
  // class field typing. This prevents undefined table access in edge startup
  // or migration states.
  const table = offlineDb.tables.find((t) => t.name === "pendingSync");
  return (table as Table<PendingSync, number> | undefined) ?? null;
}

export async function cacheEquipment(items: Equipment[]) {
  await offlineDb.equipment.bulkPut(items);
}

export async function getCachedEquipment(): Promise<Equipment[]> {
  return offlineDb.equipment.toArray();
}

export async function getCachedEquipmentById(id: string): Promise<Equipment | undefined> {
  return offlineDb.equipment.get(id);
}

export async function updateCachedEquipment(id: string, updates: Partial<Equipment>) {
  await offlineDb.equipment.update(id, updates);
}

export async function cacheScanLogs(equipmentId: string, logs: ScanLog[]) {
  await offlineDb.scanLogs.bulkPut(logs);
}

export async function getCachedScanLogs(equipmentId: string): Promise<ScanLog[]> {
  return offlineDb.scanLogs
    .where("equipmentId")
    .equals(equipmentId)
    .reverse()
    .sortBy("timestamp");
}

export async function cacheFolders(items: Folder[]) {
  await offlineDb.folders.bulkPut(items);
}

export async function getCachedFolders(): Promise<Folder[]> {
  return offlineDb.folders.toArray();
}

export async function cacheRooms(items: Room[]) {
  await offlineDb.rooms.bulkPut(items);
}

export async function getCachedRooms(): Promise<Room[]> {
  return offlineDb.rooms.toArray();
}

export async function getCachedRoomById(id: string): Promise<Room | undefined> {
  return offlineDb.rooms.get(id);
}

// checkout and return are idempotent per endpoint: a second offline tap on the
// same item should overwrite the queued entry rather than replay it twice.
// "scan" is intentionally excluded: each scan is a distinct audit event
// (different status/note) and must be replayed individually to preserve the
// full scanLogs history — collapsing them would silently drop intermediate entries.
const DEDUP_SYNC_TYPES: ReadonlySet<PendingSyncType> = new Set([
  "checkout",
  "return",
  "return_with_charge",
]);

export async function addPendingSync(op: PendingSyncCreateInput): Promise<number | undefined> {
  assertPendingSyncEnqueueAllowed({
    type: op.type,
    endpoint: op.endpoint,
    method: op.method,
  });

  const table = getPendingSyncTable();
  if (!table) return undefined;

  const row = materializePendingSyncRow(op);

  if (DEDUP_SYNC_TYPES.has(op.type)) {
    try {
      const result = await offlineDb.transaction("rw", table, async () => {
        const existing = await table
          .where("status")
          .equals("pending")
          .and(
            (item) =>
              item.endpoint === op.endpoint &&
              item.method === op.method &&
              item.type === op.type,
          )
          .first();

        if (existing?.id !== undefined) {
          await table.update(existing.id, {
            clientTimestamp: op.clientTimestamp,
            createdAt: op.createdAt,
            body: op.body,
            optimisticData: op.optimisticData,
            equipmentName: op.equipmentName,
            retries: 0,
            updatedAt: new Date(),
          });
          return existing.id;
        }

        return (await table.add(row)) as number;
      });
      return result;
    } catch {
      // Fall through to non-transactional insert if tx fails
    }
  }

  return table.add(row) as Promise<number>;
}

export async function getPendingSync(): Promise<PendingSync[]> {
  return offlineDb.pendingSync
    .where("status")
    .equals("pending")
    .sortBy("clientTimestamp");
}

export async function getAllPendingSync(): Promise<PendingSync[]> {
  return offlineDb.pendingSync.orderBy("createdAt").toArray();
}

export async function updatePendingSync(id: number, updates: Partial<PendingSync>) {
  return offlineDb.pendingSync.update(id, { ...updates, updatedAt: new Date() });
}

export async function removePendingSync(id: number) {
  return offlineDb.pendingSync.delete(id);
}

export async function getPendingCount(): Promise<number> {
  return offlineDb.pendingSync.where("status").equals("pending").count();
}

export async function getFailedCount(): Promise<number> {
  return offlineDb.pendingSync.where("status").equals("failed").count();
}

export async function getDeadCount(): Promise<number> {
  return offlineDb.pendingSync.where("status").equals("dead").count();
}

export async function getConflictCount(): Promise<number> {
  return offlineDb.pendingSync.where("status").equals("conflict").count();
}

/** Rows needing operator attention (retryable, terminal, or OCC conflict). */
export async function getAttentionCount(): Promise<number> {
  const [failed, dead, conflict] = await Promise.all([
    getFailedCount(),
    getDeadCount(),
    getConflictCount(),
  ]);
  return failed + dead + conflict;
}

/**
 * Crash/tab-kill safety: in-flight claims return to the FIFO queue.
 * Call before `runStartupCleanup` (see `initSyncEngine`).
 */
export async function recoverProcessingPendingSync(): Promise<number> {
  const processingIds = (await offlineDb.pendingSync
    .where("status")
    .equals("processing")
    .primaryKeys()) as number[];
  if (processingIds.length === 0) return 0;
  await offlineDb.pendingSync
    .where("status")
    .equals("processing")
    .modify({ status: "pending", updatedAt: new Date() });
  return processingIds.length;
}

export async function getConflictRows(): Promise<PendingSync[]> {
  return offlineDb.pendingSync.where("status").equals("conflict").toArray();
}

export async function runStartupCleanup(queryClient?: QueryClient): Promise<void> {
  try {
    // Optional retention for terminal dead-letter only — never auto-delete `conflict`.
    const deadCutoff = new Date(Date.now() - DEAD_LETTER_RETENTION_MS);
    const deadOld = await offlineDb.pendingSync
      .where("status")
      .equals("dead")
      .and((item) => item.createdAt < deadCutoff)
      .primaryKeys();
    if (deadOld.length > 0) {
      await offlineDb.pendingSync.bulkDelete(deadOld as number[]);
    }

    const syncedIds = await offlineDb.pendingSync
      .where("status")
      .equals("synced")
      .primaryKeys();
    if (syncedIds.length > 0) {
      await offlineDb.pendingSync.bulkDelete(syncedIds as number[]);
    }

    const allEquipmentIds = await offlineDb.equipment
      .toCollection()
      .primaryKeys() as string[];
    const equipmentIdSet = new Set(allEquipmentIds);

    const allLogs = await offlineDb.scanLogs.toArray();
    const toDeleteLogs: string[] = [];

    const byEquipment = new Map<string, typeof allLogs>();
    for (const log of allLogs) {
      if (!equipmentIdSet.has(log.equipmentId)) {
        toDeleteLogs.push(log.id);
        continue;
      }
      const group = byEquipment.get(log.equipmentId) ?? [];
      group.push(log);
      byEquipment.set(log.equipmentId, group);
    }

    for (const [, logs] of byEquipment) {
      if (logs.length > 200) {
        logs.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
        const excess = logs.slice(0, logs.length - 200);
        for (const l of excess) toDeleteLogs.push(l.id);
      }
    }

    if (toDeleteLogs.length > 0) {
      await offlineDb.scanLogs.bulkDelete(toDeleteLogs);
    }

    if (queryClient) {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
    }
  } catch {
  }
}
