import type {
  Equipment,
  CriticalEquipment,
  EquipmentReturn,
  CreateReturnRequest,
  UpdateReturnRequest,
  CreateEquipmentRequest,
  UpdateEquipmentRequest,
  ScanEquipmentRequest,
  EquipmentSeenResponse,
  ShiftHandoverSummary,
  ShiftHandoverSession,
  ShiftHandoverPatientsResponse,
  ShiftHandoverSnapshotRecord,
  InventoryContainer,
  InventoryContainerWithItems,
  ConsumablesReport,
  ActivePatient,
  ScanLog,
  TransferLog,
  Folder,
  Room,
  CreateRoomRequest,
  UpdateRoomRequest,
  BulkVerifyRoomResult,
  ActivityFeedItem,
  AnalyticsSummary,
  BulkDeleteRequest,
  BulkMoveRequest,
  BulkResult,
  User,
  DeletedEquipment,
  UploadUrlRequest,
  UploadUrlResponse,
  AlertAcknowledgment,
  SystemMetrics,
  SupportTicket,
  CreateSupportTicketRequest,
  Shift,
  UserRole,
  ShiftRole,
  ShiftImport,
  ShiftImportPreview,
  ShiftImportResult,
  Appointment,
  AppointmentVetMeta,
  CreateAppointmentRequest,
  MedicationExecutionPayload,
  MedicationExecutionTask,
  UpdateAppointmentRequest,
  TaskDashboard,
  TaskRecommendations,
  DrugFormularyEntry,
  CreateDrugFormularyRequest,
  CrashCartItem,
  CreateCrashCartItemRequest,
  UpdateCrashCartItemRequest,
  RestockSession,
  RestockContainerView,
  RestockFinishSummary,
  BillingLedgerEntry,
  BillingSummary,
  LeakageReport,
  InventoryItem,
  PurchaseOrder,
  ForecastParseResponse,
  ForecastApproveResponse,
  ForecastKeepaliveResponse,
  DisplaySnapshot,
  CodeBlueReconciliationSession,
  CodeBlueDispense,
  ManualBillingRequest,
  ShiftCompletionResult,
} from "@/types";
import type { OutcomeKpiRoiResponse } from "../../shared/er-types.js";
import type { AuthoritySnapshot } from "../../shared/authority.js";
import type {
  HandoffEligiblePatientsResponse,
  HandoffEligibleStaffResponse,
  CreateHandoffResponse,
  MyHandoffsResponse,
  HandoffDetailResponse,
  UpsertItemRequest,
  UpsertItemResponse,
  SubmitHandoffRequest,
  SubmitHandoffResponse,
  ReviewHandoffRequest,
  ReviewHandoffResponse,
  CancelHandoffRequest,
  CancelHandoffResponse,
} from "../../shared/patient-handoff-types.js";
import { getStoredLocale, t } from "@/lib/i18n";
import { toast } from "sonner";
import type { PendingSyncType } from "./offline-db";
import {
  addPendingSync,
  getCachedEquipment,
  getCachedEquipmentById,
  getCachedScanLogs,
  getCachedFolders,
  getCachedRooms,
  getCachedRoomById,
  cacheEquipment,
  cacheScanLogs,
  cacheFolders,
  cacheRooms,
  updateCachedEquipment,
} from "./offline-db";
import {
  getCurrentUserId,
  getCurrentUserEmail,
} from "./auth-store";
import { authFetch } from "./auth-fetch";
import { navigate } from "wouter/use-browser-location";
import { isOnline } from "./safe-browser";
const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

function buildHeaders(): Record<string, string> {
  return { ...BASE_HEADERS, "X-Locale": getStoredLocale() };
}

/** Multipart uploads must not send `Content-Type: application/json` so the boundary is preserved. */
function mergeRequestHeaders(init: RequestInit): Record<string, string> {
  const merged: Record<string, string> = {
    ...buildHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (typeof FormData !== "undefined" && init.body instanceof FormData) {
    delete merged["Content-Type"];
  }
  return merged;
}

interface OfflineOptions {
  offlineType: PendingSyncType;
  offlineEquipmentId?: string;
  optimisticResult?: unknown;
}

interface ApiErrorPayload {
  code?: string;
  error?: string;
  reason?: string;
  message?: string;
  requestId?: string;
}

/** Error codes may be top-level (`error`, `code`) or nested (`data.code`) depending on handler. */
function extractApiErrorCode(json: ApiErrorPayload & Record<string, unknown>): string {
  if (typeof json.error === "string" && json.error) return json.error;
  if (typeof json.code === "string" && json.code) return json.code;
  const data = json.data;
  if (data && typeof data === "object" && data !== null && "code" in data) {
    const c = (data as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return "UNKNOWN";
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

class OfflineResponseError extends Error {
  constructor() {
    super("Offline response received");
    this.name = "OfflineResponseError";
  }
}

/**
 * Error thrown by `request` / `requestWithOfflineFallback` for non-2xx responses.
 * Preserves the server's error `code` and any structured fields (e.g.
 * `invalidatedItems` from POST /patient-handoffs/:id/submit) so callers can
 * branch on `e.code` and read extras without losing them in `new Error(message)`.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  payload: ApiErrorPayload & Record<string, unknown>;
  invalidatedItems?: Array<{ id: string; hospitalizationId: string; reason: string }>;
  constructor(status: number, message: string, payload: ApiErrorPayload & Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    if (typeof payload.code === "string" && payload.code) this.code = payload.code;
    else if (typeof payload.error === "string" && payload.error) this.code = payload.error;
    if (typeof payload.requestId === "string") this.requestId = payload.requestId;
    if (Array.isArray(payload.invalidatedItems)) {
      this.invalidatedItems = payload.invalidatedItems as ApiError["invalidatedItems"];
    }
  }
}

function isOfflineResponse(status: number, payload: unknown): boolean {
  if (status !== 503) return false;
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as { offline?: unknown; error?: unknown };
  if (candidate.offline === true) return true;
  return typeof candidate.error === "string" && candidate.error.toLowerCase().includes("network unavailable");
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof OfflineResponseError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (!isOnline()) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.message.includes("Failed to fetch")) return true;
  return false;
}

const FETCH_TIMEOUT_MS = 30_000;
/** Shorter deadline for equipment list so a stuck Redis/backend cannot block the UI for the default 30s. */
export const EQUIPMENT_LIST_FETCH_TIMEOUT_MS = 5_000;
/** Fail fast task dashboards/queues so operational screens can recover quickly. */
export const TASKS_FETCH_TIMEOUT_MS = 5_000;
let authRedirectInProgress = false;

function redirectToSignInSoft(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/signin") return;
  navigate("/signin", { replace: true });
}

function toApiErrorMessage(status: number, payload: ApiErrorPayload | null): string {
  const base = payload?.message || payload?.error || `HTTP ${status}`;
  if (payload?.requestId) {
    return `${base} (requestId: ${payload.requestId})`;
  }
  return base;
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const outer = init.signal as AbortSignal | undefined | null;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (outer) {
    const onAbort = () => controller.abort();
    outer.addEventListener("abort", onAbort, { once: true });
    controller.signal.addEventListener("abort", () => outer.removeEventListener("abort", onAbort), { once: true });
  }

  return authFetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      if (timedOut && err instanceof DOMException && err.name === "AbortError") {
        throw new TimeoutError(timeoutMs);
      }
      throw err;
    });
}

/** Success body from POST /api/containers/:id/dispense */
export type ContainerDispenseSuccessPayload = {
  success: boolean;
  emergencyEventId?: string;
  dispensed?: Array<{ itemId: string; label: string; quantity: number; newStock: number }>;
  takenBy: { userId: string; displayName: string };
  takenAt: string;
  billingIds?: string[];
  autoBilledCents?: number;
};

export type ContainerDispenseClientResult =
  | { ok: true; data: ContainerDispenseSuccessPayload }
  | { ok: false; error: string; message: string };

/**
 * Dispense with structured result (no throw on ORPHAN_DISPENSE_BLOCKED) for UI bypass flows.
 * Caller supplies a fresh `idempotencyKey` per user attempt.
 */
export async function containerDispenseWithResult(
  containerId: string,
  body: {
    items: Array<{ itemId: string; quantity: number }>;
    animalId?: string | null;
    patientId?: string;
    isEmergency?: boolean;
    bypassReason?: "EMERGENCY_CPR" | "PROTOCOL_OVERRIDE" | "TECH_ERROR";
  },
  idempotencyKey: string,
): Promise<ContainerDispenseClientResult> {
  const url = `/api/containers/${containerId}/dispense`;
  const init: RequestInit = {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
  };
  const headers = mergeRequestHeaders(init);
  try {
    const res = await fetchWithTimeout(url, { ...init, headers });
    const json = (await res.json().catch(() => ({}))) as ApiErrorPayload & Record<string, unknown>;

    if (res.status === 401) {
      const method = String(init.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (!authRedirectInProgress) {
          authRedirectInProgress = true;
          toast.error(t.api.sessionExpired);
        }
        if (authRedirectInProgress) {
          redirectToSignInSoft();
        }
        throw new Error("Session expired");
      }
      throw new Error("UNAUTHORIZED");
    }

    if (res.ok) {
      return { ok: true, data: json as ContainerDispenseSuccessPayload };
    }

    const errCode = extractApiErrorCode(json);
    const message = toApiErrorMessage(res.status, json);

    if (res.status === 400 && errCode === "ORPHAN_DISPENSE_BLOCKED") {
      return { ok: false, error: "ORPHAN_DISPENSE_BLOCKED", message };
    }

    if (res.status >= 500) {
      toast.error(t.api.serverError, { id: "server-error" });
    }

    return { ok: false, error: errCode, message };
  } catch (err) {
    if (isNetworkError(err)) {
      toast.error(t.api.networkUnavailable, { id: "network-error" });
    }
    throw err;
  }
}

export async function request<T>(
  url: string,
  init: RequestInit = {},
  offline?: OfflineOptions,
  silent?: boolean,
  timeoutMs?: number
): Promise<T> {
  const headers = mergeRequestHeaders(init);

  try {
    const res = await fetchWithTimeout(url, { ...init, headers }, timeoutMs ?? FETCH_TIMEOUT_MS);
    if (res.status === 401) {
      const method = String(init.method ?? "GET").toUpperCase();
      if (method === "GET") {
        // Token expired/invalid. Avoid reload loops; route to sign-in once.
        if (!authRedirectInProgress) {
          authRedirectInProgress = true;
          toast.error(t.api.sessionExpired);
        }
        if (authRedirectInProgress) {
          redirectToSignInSoft();
        }
        throw new Error("Session expired");
      }
      // For mutations, do not force a hard navigation from inside the request helper.
      throw new Error("UNAUTHORIZED");
    }
    if (!res.ok) {
      if (!silent && res.status >= 500) {
        toast.error(t.api.serverError, { id: "server-error" });
      }
      const error = (await res.json().catch(() => ({ error: "Request failed" }))) as ApiErrorPayload & Record<string, unknown>;
      if (isOfflineResponse(res.status, error)) {
        throw new OfflineResponseError();
      }
      throw new ApiError(res.status, toApiErrorMessage(res.status, error), error);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    if (!silent && isNetworkError(err)) {
      toast.error(t.api.networkUnavailable, { id: "network-error" });
    }
    if (isNetworkError(err) && offline) {
      const clientTimestamp = Date.now();
      await addPendingSync({
        type: offline.offlineType,
        endpoint: url,
        method: (init.method as string) || "GET",
        body: (init.body as string) || "",
        createdAt: new Date(),
        retries: 0,
        status: "pending",
        clientTimestamp,
        optimisticData: offline.optimisticResult
          ? JSON.stringify(offline.optimisticResult)
          : undefined,
      });

      if (offline.optimisticResult !== undefined) {
        return offline.optimisticResult as T;
      }

      if (offline.offlineEquipmentId) {
        const cached = await getCachedEquipmentById(offline.offlineEquipmentId);
        if (cached) return cached as T;
      }

      throw new Error("Action queued for sync when back online");
    }
    throw err;
  }
}

async function requestWithOfflineFallback<T>(
  url: string,
  fallback: () => Promise<T>,
  init: RequestInit = {}
): Promise<T> {
  const headers = { ...buildHeaders(), ...(init.headers as Record<string, string> | undefined) };
  try {
    const res = await fetchWithTimeout(url, { ...init, headers });
    if (!res.ok) {
      const error = (await res.json().catch(() => ({ error: "Request failed" }))) as ApiErrorPayload & Record<string, unknown>;
      if (isOfflineResponse(res.status, error)) {
        throw new OfflineResponseError();
      }
      throw new ApiError(res.status, toApiErrorMessage(res.status, error), error);
    }
    return res.json();
  } catch (err) {
    if (isNetworkError(err)) {
      return fallback();
    }
    throw err;
  }
}

export interface EquipmentPage {
  items: Equipment[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface MutationResponse {
  equipment: Equipment;
  undoToken: string | undefined;
  pendingSyncId?: number;
  returnRecord?: EquipmentReturn | null;
}

interface ReturnMutationResponse extends MutationResponse {
  returnRecord?: EquipmentReturn | null;
}

async function handleOptimisticMutation(opts: {
  id: string;
  endpoint: string;
  syncType: PendingSyncType;
  requestBody: Record<string, unknown>;
  optimisticEquipment: Partial<Equipment>;
  cachedEquipment: Equipment | undefined;
}): Promise<MutationResponse> {
  const clientTimestamp = Date.now();
  try {
    const result = await request<{ equipment: Equipment; undoToken: string; returnRecord?: EquipmentReturn | null }>(
      opts.endpoint,
      {
        method: "POST",
        body: JSON.stringify(opts.requestBody),
        headers: { "X-Client-Timestamp": String(clientTimestamp) },
      }
    );
    updateCachedEquipment(opts.id, result.equipment).catch(() => {});
    return { ...result, pendingSyncId: undefined };
  } catch (err) {
    if (isNetworkError(err)) {
      const pendingSyncId = await addPendingSync({
        type: opts.syncType,
        endpoint: opts.endpoint,
        method: "POST",
        body: JSON.stringify(opts.requestBody),
        createdAt: new Date(),
        retries: 0,
        status: "pending",
        clientTimestamp,
        optimisticData: JSON.stringify(opts.optimisticEquipment),
        equipmentName: opts.cachedEquipment?.name,
      });
      const updated = { ...(opts.cachedEquipment || {}), ...opts.optimisticEquipment, id: opts.id } as Equipment;
      await updateCachedEquipment(opts.id, opts.optimisticEquipment);
      return { equipment: updated, undoToken: undefined, pendingSyncId: pendingSyncId as number };
    }
    throw err;
  }
}

async function createReturnRecordForEquipment(params: {
  equipmentId: string;
  isPluggedIn: boolean;
  plugInDeadlineMinutes?: number;
}): Promise<EquipmentReturn | undefined> {
  try {
    return await request<EquipmentReturn>("/api/returns", {
      method: "POST",
      body: JSON.stringify({
        equipmentId: params.equipmentId,
        isPluggedIn: params.isPluggedIn,
        ...(params.plugInDeadlineMinutes !== undefined && { plugInDeadlineMinutes: params.plugInDeadlineMinutes }),
      } satisfies CreateReturnRequest),
    }, undefined, true);
  } catch {
    return undefined;
  }
}

export const api = {
  equipment: {
    list: async () => {
      try {
        const result = await request<EquipmentPage>(
          "/api/equipment",
          {},
          undefined,
          undefined,
          EQUIPMENT_LIST_FETCH_TIMEOUT_MS
        );
        cacheEquipment(result.items).catch(() => {});
        return result.items;
      } catch (err) {
        if (isNetworkError(err)) {
          return getCachedEquipment();
        }
        throw err;
      }
    },
    listPaginated: async (page = 1, pageSize = 100, filters?: { q?: string; status?: string; folder?: string; location?: string }): Promise<EquipmentPage> => {
      try {
        const params = new URLSearchParams({ limit: String(pageSize), page: String(page) });
        const q = filters?.q?.trim();
        if (q) params.set("q", q);
        if (filters?.status && filters.status !== "all") params.set("status", filters.status);
        if (filters?.folder && filters.folder !== "all") params.set("folder", filters.folder);
        if (filters?.location && filters.location !== "all") params.set("location", filters.location);
        const result = await request<EquipmentPage>(
          `/api/equipment?${params}`,
          {},
          undefined,
          undefined,
          EQUIPMENT_LIST_FETCH_TIMEOUT_MS
        );
        cacheEquipment(result.items).catch(() => {});
        return result;
      } catch (err) {
        if (isNetworkError(err)) {
          const cached = await getCachedEquipment();
          const start = (page - 1) * pageSize;
          const slice = cached.slice(start, start + pageSize);
          return {
            items: slice,
            total: cached.length,
            page,
            pageSize,
            hasMore: start + pageSize < cached.length,
          };
        }
        throw err;
      }
    },
    listMy: async () => {
      try {
        const items = await request<Equipment[]>("/api/equipment/my");
        return items;
      } catch (err) {
        if (isNetworkError(err)) {
          const all = await getCachedEquipment();
          const userId = getCurrentUserId();
          // checkedOutById stores DB user IDs; compare against DB user ID from auth-store.
          if (userId) return all.filter((e) => e.checkedOutById === userId);
          return [];
        }
        throw err;
      }
    },
    get: async (id: string) => {
      try {
        const item = await request<Equipment>(`/api/equipment/${id}`);
        updateCachedEquipment(id, item).catch(() => {});
        return item;
      } catch (err) {
        if (isNetworkError(err)) {
          const cached = await getCachedEquipmentById(id);
          if (cached) return cached;
        }
        throw err;
      }
    },
    getCriticalEquipment: () => request<CriticalEquipment[]>("/api/equipment/critical"),
    create: (data: CreateEquipmentRequest, signal?: AbortSignal) =>
      request<Equipment>(
        "/api/equipment",
        { method: "POST", body: JSON.stringify(data), signal },
        { offlineType: "create" }
      ),
    importCsv: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // Do NOT set Content-Type — browser sets it automatically with multipart boundary
      const headers: Record<string, string> = { "X-Locale": getStoredLocale() };
      const res = await fetchWithTimeout(
        "/api/equipment/import",
        { method: "POST", body: form, headers },
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ inserted: number; skipped: Array<{ row: number; reason: string; data: Record<string, string> }> }>;
    },
    update: (id: string, data: UpdateEquipmentRequest) =>
      request<Equipment>(
        `/api/equipment/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
        { offlineType: "update", offlineEquipmentId: id, optimisticResult: data }
      ),
    delete: (id: string) =>
      request<void>(
        `/api/equipment/${id}`,
        { method: "DELETE" },
        { offlineType: "delete" }
      ),
    scan: async (id: string, data: ScanEquipmentRequest) => {
      const cached = await getCachedEquipmentById(id);
      const now = new Date().toISOString();
      const clientTimestamp = Date.now();

      const optimisticEquipment: Partial<Equipment> = {
        status: data.status,
        lastSeen: now,
        lastStatus: data.status,
        ...(data.status === "maintenance" && { lastMaintenanceDate: now }),
        ...(data.status === "sterilized" && { lastSterilizationDate: now }),
      };

      const optimisticScanLog: ScanLog = {
        id: `pending-${clientTimestamp}`,
        equipmentId: id,
        userId: data.userId || getCurrentUserId(),
        userEmail: data.userEmail || getCurrentUserEmail(),
        status: data.status,
        note: data.note || null,
        photoUrl: data.photoUrl || null,
        timestamp: now,
      };

      const optimistic = {
        equipment: { ...(cached || {}), ...optimisticEquipment, id } as Equipment,
        scanLog: optimisticScanLog,
        undoToken: undefined as string | undefined,
        pendingSyncId: undefined as number | undefined,
      };

      try {
        const result = await request<{ equipment: Equipment; scanLog: ScanLog; undoToken: string }>(
          `/api/equipment/${id}/scan`,
          {
            method: "POST",
            body: JSON.stringify(data),
            headers: { "X-Client-Timestamp": String(clientTimestamp) },
          }
        );
        updateCachedEquipment(id, result.equipment).catch(() => {});
        cacheScanLogs(id, [result.scanLog]).catch(() => {});
        return { ...result, pendingSyncId: undefined as number | undefined };
      } catch (err) {
        if (isNetworkError(err)) {
          const pendingSyncId = await addPendingSync({
            type: "scan",
            endpoint: `/api/equipment/${id}/scan`,
            method: "POST",
            body: JSON.stringify(data),
            createdAt: new Date(),
            retries: 0,
            status: "pending",
            clientTimestamp,
            optimisticData: JSON.stringify(optimistic),
            equipmentName: cached?.name,
          });
          await updateCachedEquipment(id, optimisticEquipment);
          cacheScanLogs(id, [optimisticScanLog]).catch(() => {});
          return { ...optimistic, pendingSyncId: pendingSyncId as number };
        }
        throw err;
      }
    },
    seen: async (id: string, body?: { roomId?: string | null }) => {
      const cached = await getCachedEquipmentById(id);
      const bodyStr = JSON.stringify({ roomId: body?.roomId ?? null });
      try {
        const result = await request<EquipmentSeenResponse>(`/api/equipment/${id}/seen`, {
          method: "POST",
          body: bodyStr,
        });
        if ("linked" in result && result.linked && result.animal) {
          await updateCachedEquipment(id, {
            linkedAnimalId: result.animal.id,
            linkedAnimalName: result.animal.name,
          }).catch(() => {});
        }
        return result;
      } catch (err) {
        if (isNetworkError(err)) {
          const pendingSyncId = await addPendingSync({
            type: "seen",
            endpoint: `/api/equipment/${id}/seen`,
            method: "POST",
            body: bodyStr,
            createdAt: new Date(),
            retries: 0,
            status: "pending",
            clientTimestamp: Date.now(),
            equipmentName: cached?.name,
          });
          return { pending: true, pendingSyncId } as const;
        }
        throw err;
      }
    },
    checkout: async (id: string, location?: string) => {
      const cached = await getCachedEquipmentById(id);
      const now = new Date().toISOString();
      return handleOptimisticMutation({
        id,
        endpoint: `/api/equipment/${id}/checkout`,
        syncType: "checkout",
        requestBody: { location },
        optimisticEquipment: {
          checkedOutById: getCurrentUserId(),
          checkedOutByEmail: getCurrentUserEmail(),
          checkedOutAt: now,
          checkedOutLocation: location || null,
        },
        cachedEquipment: cached,
      });
    },
    return: async (
      id: string,
      options?: { isPluggedIn?: boolean; plugInDeadlineMinutes?: number }
    ): Promise<ReturnMutationResponse> => {
      const cached = await getCachedEquipmentById(id);
      const now = new Date().toISOString();
      const isPluggedIn = options?.isPluggedIn ?? false;
      const returnRequest = {
        isPluggedIn,
        ...(options?.plugInDeadlineMinutes !== undefined && { plugInDeadlineMinutes: options.plugInDeadlineMinutes }),
      };
      const response = await handleOptimisticMutation({
        id,
        endpoint: `/api/equipment/${id}/return`,
        syncType: "return_with_charge",
        requestBody: returnRequest,
        optimisticEquipment: {
          checkedOutById: null,
          checkedOutByEmail: null,
          checkedOutAt: null,
          checkedOutLocation: null,
          status: "ok",
          lastSeen: now,
          lastStatus: "ok",
        },
        cachedEquipment: cached,
      });
      if (response.pendingSyncId !== undefined) {
        return response;
      }

      if (response.returnRecord) {
        return response;
      }

      const returnRecord = await createReturnRecordForEquipment({
        equipmentId: id,
        isPluggedIn,
        plugInDeadlineMinutes: options?.plugInDeadlineMinutes,
      });
      return {
        ...response,
        returnRecord,
      };
    },
    bulkDelete: (data: BulkDeleteRequest) =>
      request<BulkResult>(
        "/api/equipment/bulk-delete",
        { method: "POST", body: JSON.stringify(data) }
      ),
    bulkMove: (data: BulkMoveRequest) =>
      request<BulkResult>("/api/equipment/bulk-move", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    revert: (id: string, undoToken: string) =>
      request<Equipment>(`/api/equipment/${id}/revert`, {
        method: "POST",
        body: JSON.stringify({ undoToken }),
      }),
    logs: async (id: string) => {
      try {
        const result = await request<{ items: ScanLog[]; total: number; hasMore: boolean }>(
          `/api/equipment/${id}/logs?limit=50`
        );
        cacheScanLogs(id, result.items).catch(() => {});
        return result.items;
      } catch (err) {
        if (isNetworkError(err)) {
          return getCachedScanLogs(id);
        }
        throw err;
      }
    },
    logsPaginated: async (
      id: string,
      page = 1,
      pageSize = 50
    ): Promise<{ items: ScanLog[]; total: number; page: number; pageSize: number; hasMore: boolean }> => {
      try {
        const result = await request<{ items: ScanLog[]; total: number; page: number; pageSize: number; hasMore: boolean }>(
          `/api/equipment/${id}/logs?limit=${pageSize}&page=${page}`
        );
        cacheScanLogs(id, result.items).catch(() => {});
        return result;
      } catch (err) {
        if (isNetworkError(err)) {
          const cached = await getCachedScanLogs(id);
          const start = (page - 1) * pageSize;
          const slice = cached.slice(start, start + pageSize);
          return { items: slice, total: cached.length, page, pageSize, hasMore: start + pageSize < cached.length };
        }
        throw err;
      }
    },
    transfers: (id: string) =>
      requestWithOfflineFallback<TransferLog[]>(
        `/api/equipment/${id}/transfers`,
        () => Promise.resolve([])
      ),
    listDeleted: () => request<DeletedEquipment[]>("/api/equipment/deleted"),
    restore: (id: string) => request<Equipment>(`/api/equipment/${id}/restore`, { method: "POST" }),
  },
  returns: {
    create: (data: CreateReturnRequest) =>
      request<EquipmentReturn>("/api/returns", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: UpdateReturnRequest) =>
      request<EquipmentReturn>(`/api/returns/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
  folders: {
    list: async () => {
      try {
        const items = await request<Folder[]>("/api/folders");
        cacheFolders(items).catch(() => {});
        return items;
      } catch (err) {
        if (isNetworkError(err)) {
          return getCachedFolders();
        }
        throw err;
      }
    },
    create: (name: string) =>
      request<Folder>(
        "/api/folders",
        { method: "POST", body: JSON.stringify({ name }) }
      ),
    update: (id: string, name: string) =>
      request<Folder>(
        `/api/folders/${id}`,
        { method: "PATCH", body: JSON.stringify({ name }) }
      ),
    delete: (id: string) =>
      request<void>(`/api/folders/${id}`, { method: "DELETE" }),
  },
  activity: {
    feed: (cursor?: string) =>
      requestWithOfflineFallback<{ items: ActivityFeedItem[]; nextCursor: string | null }>(
        cursor ? `/api/activity?cursor=${encodeURIComponent(cursor)}` : "/api/activity",
        () => Promise.resolve({ items: [], nextCursor: null })
      ),
    myScanCount: () =>
      request<{ count: number }>("/api/activity/my-scan-count", {}, undefined, true),
  },
  analytics: {
    summary: () => request<AnalyticsSummary>("/api/analytics"),
    outcomeKpiRoi: () => request<OutcomeKpiRoiResponse>("/api/analytics/outcome-kpi-roi"),
    shiftCompletion: (from?: string, to?: string) => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const query = qs.toString();
      return request<ShiftCompletionResult>(`/api/analytics/shift-completion${query ? `?${query}` : ""}`);
    },
  },
  users: {
    list: async (status?: "pending" | "active" | "blocked"): Promise<User[]> => {
      const url = status ? `/api/users?status=${status}` : "/api/users";
      const result = await request<{ items: User[]; total: number }>(url);
      return result.items;
    },
    listPaginated: async (
      page = 1,
      pageSize = 100,
      status?: "pending" | "active" | "blocked"
    ): Promise<{ items: User[]; total: number; page: number; pageSize: number; hasMore: boolean }> => {
      const url = `/api/users?page=${page}&limit=${pageSize}${status ? `&status=${status}` : ""}`;
      return request<{ items: User[]; total: number; page: number; pageSize: number; hasMore: boolean }>(
        url
      );
    },
    listPending: () => request<User[]>("/api/users/pending"),
    listDeleted: () => request<User[]>("/api/users/deleted"),
    updateRole: (id: string, role: "admin" | "vet" | "technician" | "senior_technician" | "student") =>
      request<User>(
        `/api/users/${id}/role`,
        { method: "PATCH", body: JSON.stringify({ role }) }
      ),
    updateSecondaryRole: (id: string, secondaryRole: string | null) =>
      request<{ user: User }>(`/api/users/${id}/secondary-role`, {
        method: "PATCH",
        body: JSON.stringify({ secondaryRole }),
      }),
    updateStatus: (id: string, status: "pending" | "active" | "blocked") =>
      request<User>(
        `/api/users/${id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) }
      ),
    delete: (id: string) =>
      request<User>(`/api/users/${id}/delete`, { method: "PATCH" }),
    restore: (id: string) =>
      request<User>(`/api/users/${id}/restore`, { method: "PATCH" }),
    me: () => request<User & {
      effectiveRole?: UserRole | ShiftRole;
      roleSource?: "shift" | "permanent";
      activeShift?: Shift | null;
      resolvedAt?: string;
      authority?: AuthoritySnapshot;
    }>("/api/users/me"),
  },
  storage: {
    requestUploadUrl: (data: UploadUrlRequest) =>
      request<UploadUrlResponse>(
        "/api/storage/upload-url",
        { method: "POST", body: JSON.stringify(data) }
      ),
  },
  whatsapp: {
    sendAlert: (data: {
      equipmentId: string;
      status: string;
      note?: string;
      phone?: string;
    }) =>
      request<{ success: boolean; waUrl: string }>(
        "/api/whatsapp/alert",
        { method: "POST", body: JSON.stringify(data) }
      ),
  },
  alertAcks: {
    list: () => request<AlertAcknowledgment[]>("/api/alert-acks"),
    acknowledge: (equipmentId: string, alertType: string) =>
      request<AlertAcknowledgment>(
        "/api/alert-acks",
        { method: "POST", body: JSON.stringify({ equipmentId, alertType }) }
      ),
    remove: (equipmentId: string, alertType: string) =>
      request<void>(
        `/api/alert-acks?equipmentId=${encodeURIComponent(equipmentId)}&alertType=${encodeURIComponent(alertType)}`,
        { method: "DELETE" }
      ),
  },
  push: {
    getVapidPublicKey: () =>
      request<{ publicKey: string }>("/api/push/vapid-public-key"),
    subscribe: (subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      soundEnabled?: boolean;
      alertsEnabled?: boolean;
      technicianReturnRemindersEnabled?: boolean;
      seniorOwnReturnRemindersEnabled?: boolean;
      seniorTeamOverdueAlertsEnabled?: boolean;
      adminHourlySummaryEnabled?: boolean;
    }) =>
      request<{ success: boolean; id: string }>(
        "/api/push/subscribe",
        { method: "POST", body: JSON.stringify(subscription) }
      ),
    update: (payload: {
      endpoint: string;
      soundEnabled?: boolean;
      alertsEnabled?: boolean;
      technicianReturnRemindersEnabled?: boolean;
      seniorOwnReturnRemindersEnabled?: boolean;
      seniorTeamOverdueAlertsEnabled?: boolean;
      adminHourlySummaryEnabled?: boolean;
    }) =>
      request<void>(
        "/api/push/subscribe",
        { method: "PATCH", body: JSON.stringify(payload) }
      ),
    unsubscribe: (endpoint: string) =>
      request<void>(
        "/api/push/subscribe",
        { method: "DELETE", body: JSON.stringify({ endpoint }) }
      ),
    sendTest: () =>
      request<{ success: boolean }>(
        "/api/push/test",
        { method: "POST" }
      ),
  },
  shifts: {
    list: (date?: string) =>
      request<Shift[]>(date ? `/api/shifts?date=${encodeURIComponent(date)}` : "/api/shifts"),
    imports: () => request<ShiftImport[]>("/api/shifts/imports"),
    previewImport: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const headers: Record<string, string> = { "X-Locale": getStoredLocale() };
      const res = await fetchWithTimeout(
        "/api/shifts/import/preview",
        { method: "POST", body: form, headers },
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<ShiftImportPreview>;
    },
    confirmImport: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const headers: Record<string, string> = { "X-Locale": getStoredLocale() };
      const res = await fetchWithTimeout(
        "/api/shifts/import/confirm",
        { method: "POST", body: form, headers },
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<ShiftImportResult>;
    },
  },
  appointments: {
    list: (params: { day?: string; start?: string; end?: string; vetId?: string }) => {
      const qs = new URLSearchParams();
      if (params.day) qs.set("day", params.day);
      if (params.start) qs.set("start", params.start);
      if (params.end) qs.set("end", params.end);
      if (params.vetId) qs.set("vetId", params.vetId);
      return request<{ appointments: Appointment[] }>(`/api/appointments?${qs.toString()}`).then((r) => r.appointments);
    },
    create: (data: CreateAppointmentRequest) =>
      request<{ appointment: Appointment }>(
        "/api/appointments",
        { method: "POST", body: JSON.stringify(data) }
      ).then((r) => r.appointment),
    update: (id: string, data: UpdateAppointmentRequest) =>
      request<{ appointment: Appointment }>(
        `/api/appointments/${id}`,
        { method: "PATCH", body: JSON.stringify(data) }
      ).then((r) => r.appointment),
    cancel: (id: string, reason?: string) =>
      request<{ appointment: Appointment }>(
        `/api/appointments/${id}`,
        { method: "DELETE", body: JSON.stringify(reason ? { reason } : {}) }
      ).then((r) => r.appointment),
    meta: (day: string) =>
      request<{ day: string; vets: AppointmentVetMeta[]; technicians: AppointmentVetMeta[] }>(`/api/appointments/meta?day=${encodeURIComponent(day)}`),
  },
  tasks: {
    dashboard: () => request<TaskDashboard>("/api/tasks/dashboard", {}, undefined, undefined, TASKS_FETCH_TIMEOUT_MS),
    recommendations: () =>
      request<TaskRecommendations>("/api/tasks/recommendations", {}, undefined, undefined, TASKS_FETCH_TIMEOUT_MS),
    me: () =>
      request<{ tasks: Appointment[] }>("/api/tasks/me", {}, undefined, undefined, TASKS_FETCH_TIMEOUT_MS)
        .then((r) => r.tasks),
    active: () =>
      request<{ tasks: Appointment[] }>("/api/tasks/active", {}, undefined, undefined, TASKS_FETCH_TIMEOUT_MS)
        .then((r) => r.tasks),
    medicationActive: () =>
      request<{ tasks: MedicationExecutionTask[] }>(
        "/api/tasks/medication-active",
        {},
        undefined,
        undefined,
        TASKS_FETCH_TIMEOUT_MS
      ).then((r) => r.tasks),
    start: (id: string) =>
      request<{ task: Appointment }>(`/api/tasks/${id}/start`, { method: "POST" }).then((r) => r.task),
    complete: (id: string, payload?: { execution?: MedicationExecutionPayload }) =>
      request<{ task: Appointment; inventoryWarning?: boolean }>(
        `/api/tasks/${id}/complete`,
        { method: "POST", body: JSON.stringify(payload ?? {}) },
      ),
    vetApprove: (id: string) =>
      request<{ task: Appointment }>(`/api/tasks/${id}/vet-approve`, { method: "POST" }).then((r) => r.task),
  },
  formulary: {
    list: () => request<DrugFormularyEntry[]>("/api/formulary"),
    upsert: (data: CreateDrugFormularyRequest) =>
      request<DrugFormularyEntry>("/api/formulary", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<CreateDrugFormularyRequest>) =>
      request<DrugFormularyEntry>(`/api/formulary/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) =>
      request<void>(`/api/formulary/${id}`, { method: "DELETE" }),
  },
  crashCartItems: {
    list: () => request<CrashCartItem[]>("/api/crash-cart/items"),
    create: (data: CreateCrashCartItemRequest) =>
      request<CrashCartItem>("/api/crash-cart/items", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: UpdateCrashCartItemRequest) =>
      request<CrashCartItem>(`/api/crash-cart/items/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) =>
      request<void>(`/api/crash-cart/items/${id}`, { method: "DELETE" }),
  },
  metrics: {
    get: () => request<SystemMetrics>("/api/metrics", {}, undefined, true),
  },
  support: {
    create: (data: CreateSupportTicketRequest) =>
      request<SupportTicket>(
        "/api/support",
        { method: "POST", body: JSON.stringify(data) }
      ),
    list: () => request<SupportTicket[]>("/api/support"),
    unresolvedCount: () => request<{ count: number }>("/api/support/unresolved-count"),
    update: (id: string, data: { status?: string; adminNote?: string }) =>
      request<SupportTicket>(
        `/api/support/${id}`,
        { method: "PATCH", body: JSON.stringify(data) }
      ),
  },
  auditLogs: {
    list: (params?: { actionType?: string; performedBy?: string; from?: string; to?: string; page?: number }) => {
      const qs = new URLSearchParams();
      if (params?.actionType) qs.set("actionType", params.actionType);
      if (params?.performedBy) qs.set("performedBy", params.performedBy);
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.page) qs.set("page", String(params.page));
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return request<{ items: import("@/types").AuditLog[]; hasMore: boolean; page: number; pageSize: number }>(`/api/audit-logs${query}`);
    },
  },
  rooms: {
    list: async (): Promise<Room[]> => {
      try {
        const items = await request<Room[]>("/api/rooms");
        cacheRooms(items).catch(() => {});
        return items;
      } catch (err) {
        if (isNetworkError(err)) {
          return getCachedRooms();
        }
        throw err;
      }
    },
    get: async (id: string): Promise<Room> => {
      try {
        return await request<Room>(`/api/rooms/${id}`);
      } catch (err) {
        if (isNetworkError(err)) {
          const cached = await getCachedRoomById(id);
          if (cached) return cached;
        }
        throw err;
      }
    },
    create: (data: CreateRoomRequest) =>
      request<Room>("/api/rooms", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: UpdateRoomRequest) =>
      request<Room>(`/api/rooms/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/api/rooms/${id}`, { method: "DELETE" }),
    bulkVerify: (roomId: string) =>
      request<BulkVerifyRoomResult>("/api/equipment/bulk-verify-room", {
        method: "POST",
        body: JSON.stringify({ roomId }),
      }),
    activity: (roomId: string) =>
      request<import("@/types").RoomActivityEntry[]>(`/api/rooms/${roomId}/activity`),
  },
  containers: {
    list: () => request<InventoryContainer[]>("/api/containers"),
    bootstrapDefaults: () =>
      request<{ inserted: number }>("/api/containers/bootstrap-defaults", { method: "POST" }),
    create: (data: {
      name: string;
      department?: string;
      targetQuantity: number;
      currentQuantity?: number;
      roomId?: string | null;
      nfcTagId?: string | null;
    }) =>
      request<InventoryContainer>("/api/containers", { method: "POST", body: JSON.stringify(data) }),
    restock: (id: string, addedQuantity: number) =>
      request<{
        container: InventoryContainer;
        consumed: number;
        ledgerId: string | null;
        animal: { id: string; name: string } | null;
      }>(`/api/containers/${id}/restock`, {
        method: "POST",
        body: JSON.stringify({ addedQuantity }),
      }),
    blindAudit: (id: string, physicalCount: number, note?: string) =>
      request<{ containerId: string; variance: number; logId: string }>(
        `/api/containers/${id}/blind-audit`,
        { method: "POST", body: JSON.stringify({ physicalCount, note }) },
      ),
    dispense: (
      containerId: string,
      data: {
        items: Array<{ itemId: string; quantity: number }>;
        animalId?: string | null;
        patientId?: string;
        isEmergency?: boolean;
        bypassReason?: "EMERGENCY_CPR" | "PROTOCOL_OVERRIDE" | "TECH_ERROR";
      },
      options?: { idempotencyKey?: string },
    ) =>
      request<{
        success: boolean;
        emergencyEventId?: string;
        dispensed?: Array<{ itemId: string; label: string; quantity: number; newStock: number }>;
        takenBy: { userId: string; displayName: string };
        takenAt: string;
        billingIds?: string[];
        autoBilledCents?: number;
      }>(`/api/containers/${containerId}/dispense`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Idempotency-Key": options?.idempotencyKey ?? crypto.randomUUID(),
        },
      }),
    completeEmergency: (
      eventId: string,
      data: {
        items: Array<{ itemId: string; quantity: number }>;
        animalId?: string | null;
      },
    ) =>
      request<{
        success: boolean;
        dispensed: Array<{ itemId: string; label: string; quantity: number; newStock: number }>;
        takenBy: { userId: string; displayName: string };
        takenAt: string;
        billingIds: string[];
      }>(`/api/containers/emergency/${eventId}/complete`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    getByNfcTag: (nfcTagId: string) =>
      request<InventoryContainerWithItems>(
        `/api/containers?nfcTagId=${encodeURIComponent(nfcTagId)}`,
      ),
    reconcileUnusedCharge: (body: { billingLedgerId: string; note?: string }) =>
      request<{
        success: boolean;
        billingLedgerId: string;
        restoredQuantity: number;
        containerId: string;
        newStock: number;
        requestId: string;
      }>("/api/containers/reconcile-unused-charge", { method: "POST", body: JSON.stringify(body) }),
  },
  adminMedicationIntegrity: {
    list: () =>
      request<{
        clinicId: string;
        rows: Array<{
          inventoryLogId: string;
          createdAt: string;
          animalId: string | null;
          animalName: string | null;
          containerId: string;
          quantityAdded: number;
          billingEventId: string | null;
          billingTotalCents: number | null;
          billingStatus: string | null;
          activeHospitalizationId: string | null;
          discrepancyFlags: string[];
        }>;
        requestId: string;
      }>("/api/admin/medication-integrity"),
  },
  adminOutboxHealth: {
    get: () =>
      request<{
        clinicId: string;
        publish_lag_ms: number | null;
        outbox_size: number;
        events_per_sec: number;
        duplicate_drops_count: number;
        gap_resync_count: number;
        failed_publish_attempts: number;
        dead_letter_count: number;
        dlq_permanent_count: number;
        dlq_transient_count: number;
        dlq_unclassified_count: number;
        next_retry_wave_in_ms: number | null;
        max_retry_horizon_ms: number | null;
        requestId: string;
      }>("/api/admin/outbox-health"),
  },
  adminQueueMetrics: {
    get: () =>
      request<{
        queue: {
          name: string;
          live: Record<string, number> | null;
          inProcess: {
            enqueued: number;
            completed: number;
            failed: number;
            droppedRateLimit: number;
            droppedNoRedis: number;
            circuitQueueBroken: number;
          };
        };
        dlq: {
          name: string;
          live: Record<string, number> | null;
        };
        workerHeartbeat: {
          status: "ok" | "stale" | "dead" | "no_redis";
          ageMs: number | null;
        };
        isDegraded: boolean;
        redisAvailable: boolean;
        requestId: string;
      }>("/api/queue/metrics"),
  },
  restock: {
    start: (containerId: string) =>
      request<RestockSession>("/api/restock/start", {
        method: "POST",
        body: JSON.stringify({ containerId }),
      }),
    scan: (sessionId: string, params: { itemId?: string; nfcTagId?: string; observedQuantity: number }) =>
      request<{
        event: {
          id: string;
          clinicId: string;
          sessionId: string;
          containerId: string;
          itemId: string;
          delta: number;
          createdAt: string;
        };
        observedQuantity: number;
        targetPar: number;
        delta: number;
        item: { id: string; code: string; label: string; nfcTagId: string | null };
      }>("/api/restock/scan", {
        method: "POST",
        body: JSON.stringify({ sessionId, ...params }),
      }),
    finish: (sessionId: string) =>
      request<RestockFinishSummary>("/api/restock/finish", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      }),
    containerItems: (containerId: string) =>
      request<RestockContainerView>("/api/restock/container-items", {
        method: "POST",
        body: JSON.stringify({ containerId }),
      }),
  },
  billing: {
    list: (params?: { animalId?: string; status?: string; from?: string; to?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.animalId) qs.set("animalId", params.animalId);
      if (params?.status) qs.set("status", params.status);
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const query = qs.toString();
      return request<BillingLedgerEntry[]>(`/api/billing${query ? `?${query}` : ""}`);
    },
    get: (id: string) => request<BillingLedgerEntry>(`/api/billing/${id}`),
    create: (data: {
      animalId?: string;
      itemType: "EQUIPMENT" | "CONSUMABLE";
      itemId: string;
      quantity: number;
      unitPriceCents: number;
      note?: string;
    }) => request<BillingLedgerEntry>("/api/billing", { method: "POST", body: JSON.stringify(data) }),
    void: (id: string) => request<BillingLedgerEntry>(`/api/billing/${id}/void`, { method: "PATCH" }),
    bulkSync: (ids: string[]) => request<{ updated: number }>("/api/billing/bulk-sync", { method: "PATCH", body: JSON.stringify({ ids }) }),
    exportCsvUrl: () => "/api/billing/export.csv",
    summary: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      const query = qs.toString();
      return request<BillingSummary>(`/api/billing/summary${query ? `?${query}` : ""}`);
    },
    leakageReport: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      const query = qs.toString();
      return request<import("@/types").LeakageReport>(`/api/billing/leakage-report${query ? `?${query}` : ""}`);
    },
    shiftTotal: () => request<{ totalCents: number; count: number; shiftActive: boolean }>("/api/billing/shift-total"),
    inventoryJobs: (params?: { status?: string }) => {
      const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
      return request<import("@/types").InventoryJob[]>(`/api/billing/inventory-jobs${qs}`);
    },
    retryInventoryJob: (id: string) =>
      request<{ ok: boolean; id: string }>(`/api/billing/inventory-jobs/${id}/retry`, { method: "POST" }),
  },
  inventoryItems: {
    list: () => request<InventoryItem[]>("/api/inventory-items"),
    create: (data: { code: string; label: string; category?: string; nfcTagId?: string | null }) =>
      request<InventoryItem>("/api/inventory-items", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: { label?: string; category?: string | null; nfcTagId?: string | null; isBillable?: boolean; minimumDispenseToCapture?: number }) =>
      request<InventoryItem>(`/api/inventory-items/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/api/inventory-items/${id}/deactivate`, { method: "PATCH" }),
  },
  procurement: {
    list: (params?: { status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      const query = qs.toString();
      return request<PurchaseOrder[]>(`/api/procurement${query ? `?${query}` : ""}`);
    },
    get: (id: string) => request<PurchaseOrder>(`/api/procurement/${id}`),
    create: (data: {
      supplierName: string;
      lines: { itemId: string; quantityOrdered: number; unitPriceCents?: number }[];
      notes?: string;
    }) => request<PurchaseOrder>("/api/procurement", { method: "POST", body: JSON.stringify(data) }),
    submit: (id: string) => request<PurchaseOrder>(`/api/procurement/${id}/submit`, { method: "PATCH" }),
    receive: (id: string, data: { lines: { lineId: string; quantityReceived: number; containerId: string }[] }) =>
      request<PurchaseOrder>(`/api/procurement/${id}/receive`, { method: "PATCH", body: JSON.stringify(data) }),
    cancel: (id: string) => request<PurchaseOrder>(`/api/procurement/${id}/cancel`, { method: "PATCH" }),
  },
  shiftHandover: {
    getDischargeItems: (animalId: string) =>
      request<{
        items: Array<{
          sessionId: string;
          equipmentId: string;
          equipmentName: string;
          startedAt: string;
        }>;
      }>(`/api/shift-handover/discharge/${encodeURIComponent(animalId)}`),
    getSummary: () => request<ShiftHandoverSummary>("/api/shift-handover/summary"),
    startSession: (body?: { note?: string }) =>
      request<ShiftHandoverSession>("/api/shift-handover/session/start", {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    endSession: (body?: { note?: string }) =>
      request<ShiftHandoverSession>("/api/shift-handover/session/end", {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    consumablesReport: (from: string, to: string) =>
      request<ConsumablesReport>(
        `/api/shift-handover/consumables-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    getPendingEmergencies: () =>
      request<{
        items: Array<{
          id: string;
          containerId: string;
          itemName: string;
          quantity: number;
          dispensedAt: string;
          unitPriceCents: number;
        }>;
      }>("/api/shift-handover/pending-emergencies"),
    reconcileEmergency: (logId: string, data: { animalId: string; quantity?: number }) =>
      request<{ success: boolean; ledgerId: string; alreadyReconciled: boolean }>(
        `/api/shift-handover/emergency/${encodeURIComponent(logId)}/reconcile`,
        { method: "PATCH", body: JSON.stringify(data) },
      ),
    patientHandoffs: {
      eligiblePatients: () =>
        request<HandoffEligiblePatientsResponse>("/api/shift-handover/patient-handoffs/eligible-patients"),
      eligibleStaff: () =>
        request<HandoffEligibleStaffResponse>("/api/shift-handover/patient-handoffs/eligible-staff"),
      create: (data: { receivingUserId: string }) =>
        request<CreateHandoffResponse>("/api/shift-handover/patient-handoffs", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      mine: () =>
        request<MyHandoffsResponse>("/api/shift-handover/patient-handoffs/mine"),
      get: (id: string) =>
        request<HandoffDetailResponse>(`/api/shift-handover/patient-handoffs/${encodeURIComponent(id)}`),
      upsertItem: (id: string, hospitalizationId: string, data: UpsertItemRequest) =>
        request<UpsertItemResponse>(
          `/api/shift-handover/patient-handoffs/${encodeURIComponent(id)}/items/${encodeURIComponent(hospitalizationId)}`,
          { method: "PUT", body: JSON.stringify(data) },
        ),
      submit: (id: string, data: SubmitHandoffRequest) =>
        request<SubmitHandoffResponse>(
          `/api/shift-handover/patient-handoffs/${encodeURIComponent(id)}/submit`,
          { method: "POST", body: JSON.stringify(data) },
        ),
      review: (id: string, data: ReviewHandoffRequest) =>
        request<ReviewHandoffResponse>(
          `/api/shift-handover/patient-handoffs/${encodeURIComponent(id)}/review`,
          { method: "POST", body: JSON.stringify(data) },
        ),
      cancel: (id: string, data: CancelHandoffRequest) =>
        request<CancelHandoffResponse>(
          `/api/shift-handover/patient-handoffs/${encodeURIComponent(id)}/cancel`,
          { method: "POST", body: JSON.stringify(data) },
        ),
    },
    getPatients: () =>
      request<ShiftHandoverPatientsResponse>("/api/shift-handover/patients"),
    getLatestSnapshot: () =>
      request<ShiftHandoverSnapshotRecord>("/api/shift-handover/snapshot/latest"),
  },
  forecast: {
    parseJson: (body: { text: string; windowHours?: 24 | 72; weekendMode?: boolean }) =>
      request<ForecastParseResponse>("/api/forecast/parse", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    parseMultipart: (files: File[], params?: { windowHours?: 24 | 72; weekendMode?: boolean }) => {
      const fd = new FormData();
      for (const file of files) {
        fd.append("file", file);
      }
      if (params?.windowHours != null) fd.append("windowHours", String(params.windowHours));
      if (params?.weekendMode != null) fd.append("weekendMode", String(params.weekendMode));
      return request<ForecastParseResponse>("/api/forecast/parse", {
        method: "POST",
        body: fd,
      });
    },
    approve: (body: {
      parseId: string;
      manualQuantities: Record<string, number>;
      pharmacistDoseAcks?: string[];
      patientFlagAcks?: string[];
      confirmedDrugKeys?: string[];
      auditTrace?: Record<string, { forecastedQty: number | null; onHandQty: number }>;
      patientWeightOverrides?: Record<string, number>;
    }) =>
      request<ForecastApproveResponse>("/api/forecast/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    parseKeepalive: (parseId: string) =>
      request<ForecastKeepaliveResponse>(`/api/forecast/parse/${encodeURIComponent(parseId)}/keepalive`, {
        method: "POST",
      }),
    getPharmacyEmail: () =>
      request<{ pharmacyEmail: string | null; forecastPdfSourceFormat: "smartflow" | "generic" }>(
        "/api/forecast/clinic/pharmacy-email",
      ),
    setPharmacyEmail: (body: { pharmacyEmail: string | null; forecastPdfSourceFormat?: "smartflow" | "generic" }) =>
      request<{ pharmacyEmail: string | null; forecastPdfSourceFormat: "smartflow" | "generic" }>(
        "/api/forecast/clinic/pharmacy-email",
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      ),
    listExclusions: () =>
      request<{ exclusions: import("@/types").PharmacyForecastExclusion[] }>("/api/forecast/clinic/pharmacy-forecast-exclusions"),
    addExclusion: (data: { matchSubstring: string; note?: string | null }) =>
      request<{ exclusion: import("@/types").PharmacyForecastExclusion }>("/api/forecast/clinic/pharmacy-forecast-exclusions", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    removeExclusion: (id: string) =>
      request<void>(`/api/forecast/clinic/pharmacy-forecast-exclusions/${id}`, { method: "DELETE" }),
  },
  animals: {
    active: () =>
      request<{ animals: ActivePatient[] }>("/api/animals/active"),
  },
  patients: {
    list: (params?: { q?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set("q", params.q);
      if (params?.status) qs.set("status", params.status);
      const query = qs.toString();
      return request<{ patients: import("@/types").Hospitalization[] }>(
        `/api/patients${query ? `?${query}` : ""}`,
      );
    },
    search: (q: string) =>
      request<{ animals: import("@/types").AnimalSearchResult[] }>(
        `/api/patients/search?q=${encodeURIComponent(q)}`,
      ),
    get: (id: string) =>
      request<{ patient: import("@/types").Hospitalization }>(`/api/patients/${id}`),
    admit: (data: import("@/types").AdmitPatientRequest) =>
      request<{ patient: import("@/types").Hospitalization }>("/api/patients", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateStatus: (id: string, status: import("@/types").HospitalizationStatus) =>
      request<{ id: string; status: string }>(`/api/patients/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    discharge: (id: string, dischargeNotes?: string) =>
      request<{ id: string; dischargedAt: string }>(`/api/patients/${id}/discharge`, {
        method: "PATCH",
        body: JSON.stringify({ dischargeNotes }),
      }),
    update: (id: string, patch: import("@/types").UpdatePatientRequest) =>
      request<{ patient: import("@/types").Hospitalization }>(`/api/patients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  },
  codeBlue: {
    startEvent: (data: import("@/types").StartCodeBlueRequest) =>
      request<import("@/types").StartCodeBlueResponse>("/api/code-blue/events", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    endEvent: (id: string, data: import("@/types").EndCodeBlueRequest) =>
      request<{ id: string; endedAt: string | null }>(`/api/code-blue/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    history: () =>
      request<import("@/hooks/useCodeBlueSession").CodeBlueSession[]>("/api/code-blue/history"),
    reconciliationList: () =>
      request<{ sessions: CodeBlueReconciliationSession[] }>("/api/code-blue/reconciliation"),
    sessionDispenses: (sessionId: string) =>
      request<{ dispenses: CodeBlueDispense[] }>(`/api/code-blue/sessions/${sessionId}/dispenses`),
    reconcile: (sessionId: string) =>
      request<{ ok: boolean }>(`/api/code-blue/sessions/${sessionId}/reconcile`, { method: "PATCH" }),
    manualBilling: (sessionId: string, body: ManualBillingRequest) =>
      request<{ ledgerId: string }>(`/api/code-blue/sessions/${sessionId}/manual-billing`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  display: {
    snapshot: (): Promise<DisplaySnapshot> =>
      request<DisplaySnapshot>("/api/display/snapshot"),
  },
  realtime: {
    outboxHead: () => request<{ maxPublishedId: number }>("/api/realtime/outbox-head"),
    replay: (fromId: number) =>
      request<{
        events: Array<{
          id: number;
          type: string;
          payload: unknown;
          timestamp: string;
          outboxId: number;
          eventVersion: number;
          publishedAt: string | null;
        }>;
        hasMore: boolean;
      }>(`/api/realtime/replay?from_id=${encodeURIComponent(String(fromId))}`),
    telemetry: (body: { duplicateDrop?: boolean; gapResync?: boolean }) =>
      request<{ ok: boolean }>("/api/realtime/telemetry", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
};

// ── ER Wedge API (see `er-api.ts` for implementation + not-implemented handling) ─
export type {
  AckErHandoffRequest,
  AckErHandoffResponse,
  AssignErIntakeRequest,
  AssignErIntakeResponse,
  CreateErHandoffRequest,
  CreateErHandoffResponse,
  CreateErIntakeRequest,
  ErAssigneesResponse,
  ErBoardResponse,
  ErEligibleHospitalizationsResponse,
  ErImpactResponse,
  ErIntakeResponse,
  ErKpiWindowDays,
  ErModeResponse,
} from "../../shared/er-types.js";
export {
  ER_API_IMPLEMENTED_ROUTES,
  ErApiNotImplementedError,
  acceptErPatient,
  ackErHandoff,
  assignErIntake,
  completeAdmission,
  createErHandoff,
  createErIntake,
  enrichErIntake,
  enterAdmissionState,
  exitAdmissionState,
  getAdmissionState,
  getErEligibleHospitalizations,
  getErAssignees,
  getErBoard,
  getErImpact,
  getErMode,
  getErStatus,
  toggleErGlobalMode,
} from "./er-api";