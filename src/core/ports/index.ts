/**
 * Port interfaces — pure TypeScript contracts.
 * No framework imports, no Capacitor imports, no React imports.
 * Infrastructure adapters implement these; core use-cases depend on them.
 */

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
}

export interface ISyncQueue {
  getPending(): Promise<ISyncQueueEntry[]>;
  pendingCount(): Promise<number>;
  failedCount(): Promise<number>;
}

export interface StatusBarPort {
  setStyle(style: "light" | "dark"): Promise<void>;
  setBackgroundColor(hex: string): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
}

export interface KeyboardPort {
  /** Register a handler for keyboard height changes. Returns a cleanup function. */
  onHeightChange(handler: (heightPx: number) => void): () => void;
  hide(): Promise<void>;
}

export interface AuthSessionPort {
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Register a handler invoked when the session changes. Returns a cleanup function. */
  onSessionChange(handler: (token: string | null) => void): () => void;
}

export interface ApiClientPort {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  del(path: string, init?: RequestInit): Promise<void>;
}
