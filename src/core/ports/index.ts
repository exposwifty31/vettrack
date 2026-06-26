/**
 * Port interfaces — pure TypeScript contracts.
 * No framework imports, no Capacitor imports, no React imports.
 * Infrastructure adapters implement these; core use-cases depend on them.
 */

export interface IHapticsProvider {
  impact(style: "light" | "medium" | "heavy"): Promise<void>;
  selectionChanged(): Promise<void>;
  notification(type: "success" | "warning" | "error"): Promise<void>;
}

export interface NfcReadPayload {
  text: string | null;
  url: string | null;
  tagId: string | null;
}

export interface NfcScanSession {
  stop(): Promise<void>;
}

export interface INfcProvider {
  isSupported(): Promise<boolean>;
  readOnce(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<NfcReadPayload>;
  startSession(options: {
    onRead: (payload: NfcReadPayload) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<NfcScanSession>;
}

export interface IDeepLinkProvider {
  /** Register a handler for app URL opens. Returns a cleanup function. */
  onOpen(handler: (url: string) => void): () => void;
}

export interface IEquipmentCacheEntry {
  id: string;
  name: string;
  status: string;
  roomId: string | null;
  location: string | null;
  lastSeen: string | null;
  [key: string]: unknown;
}

export interface IEquipmentCache {
  getAll(): Promise<IEquipmentCacheEntry[]>;
  getById(id: string): Promise<IEquipmentCacheEntry | null>;
  upsertMany(items: IEquipmentCacheEntry[]): Promise<void>;
}

export interface ISyncQueueEntry {
  id?: number;
  type: string;
  endpoint: string;
  method: string;
  body: string;
  createdAt: Date;
  retries: number;
  status: string;
  clientTimestamp: number;
  [key: string]: unknown;
}

export interface ISyncQueue {
  getPending(): Promise<ISyncQueueEntry[]>;
  pendingCount(): Promise<number>;
  failedCount(): Promise<number>;
}
