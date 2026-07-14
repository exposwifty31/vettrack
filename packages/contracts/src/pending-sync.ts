/** Phase 5 queue state machine — shared by web (Dexie) and Expo (`expo-sqlite` adapter). */

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

/** Current pendingSync row schema version (queue evolution). */
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
  conflictPayload?: PendingSyncConflictPayload | null;
}

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

export interface PendingSyncEnqueueOp {
  type: string;
  endpoint: string;
  method: string;
}
