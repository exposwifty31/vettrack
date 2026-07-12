/**
 * Equipment API surface (Slice 3) — extracted from api.ts.
 * `api.equipment` in api.ts re-exports this object for compatibility.
 */
import type {
  Equipment,
  CriticalEquipment,
  EquipmentReturn,
  CreateReturnRequest,
  UpdateEquipmentRequest,
  CreateEquipmentRequest,
  ScanEquipmentRequest,
  EquipmentSeenResponse,
  ScanLog,
  TransferLog,
    BulkDeleteRequest,
  BulkMoveRequest,
  BulkResult,
  DeletedEquipment,
  QuickScanToggleResult,
  QuickScanToggleAction,
  EquipmentLocateResponse,
  CreateDamageReportRequest,
  CreateDamageReportResponse,
} from "@/types";
import type { EquipmentWaitlistSnapshot } from "../../../shared/equipment-waitlist.js";
import type { EquipmentTruthResponse } from "../../../shared/equipment-truth.js";
import type { CopilotExplainResponse } from "../../../shared/contracts/asset-copilot.v1.js";
import { getStoredLocale, t } from "@/lib/i18n";
import { toast } from "sonner";
import type { PendingSyncType } from "../offline-db";
import {
  classifyEmergencyEndpoint,
  recordEmergencyBlockLocally,
} from "@/lib/offline-emergency-block";
import { OfflineEmergencyMutationBlockedError } from "@/lib/offline-policy";
import {
  addPendingSync,
  getCachedEquipment,
  getCachedEquipmentById,
  getCachedScanLogs,
  cacheEquipment,
  cacheScanLogs,
  updateCachedEquipment,
} from "../offline-db";
import { getCurrentUserId, getCurrentUserEmail } from "../auth-store";
import {
  request,
  ApiError,
  OfflineResponseError,
  fetchWithTimeout,
  mergeRequestHeaders,
  isNetworkError,
  isOfflineResponse,
  reportEmergencyBlockedSilently,
  toApiErrorMessage,
  FETCH_TIMEOUT_MS,
  EQUIPMENT_LIST_FETCH_TIMEOUT_MS,
} from "../request-core";

/** GET with Dexie fallback when the network is unavailable (shared with activity feed). */
export async function requestWithOfflineFallback<T>(
  url: string,
  fallback: () => Promise<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = mergeRequestHeaders(init);
  try {
    const res = await fetchWithTimeout(url, { ...init, headers });
    if (!res.ok) {
      const error = (await res.json().catch(() => ({ error: "Request failed" }))) as Record<string, unknown>;
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
      },
    );
    updateCachedEquipment(opts.id, result.equipment).catch(() => {});
    return { ...result, pendingSyncId: undefined };
  } catch (err) {
    if (isNetworkError(err)) {
      const emergencyClass = classifyEmergencyEndpoint(opts.endpoint, "POST");
      if (emergencyClass) {
        recordEmergencyBlockLocally(emergencyClass);
        reportEmergencyBlockedSilently(emergencyClass);
        toast.error(t.api.networkUnavailable, { id: `emergency-blocked-${emergencyClass}` });
        throw new OfflineEmergencyMutationBlockedError(emergencyClass);
      }
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
    return await request<EquipmentReturn>(
      "/api/returns",
      {
        method: "POST",
        body: JSON.stringify({
          equipmentId: params.equipmentId,
          isPluggedIn: params.isPluggedIn,
          ...(params.plugInDeadlineMinutes !== undefined && {
            plugInDeadlineMinutes: params.plugInDeadlineMinutes,
          }),
        } satisfies CreateReturnRequest),
      },
      undefined,
      true,
    );
  } catch {
    return undefined;
  }
}

export const equipmentApi = {
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
    truth: (id: string) =>
      request<EquipmentTruthResponse>(`/api/equipment/${encodeURIComponent(id)}/truth`),
    /** Read-only search (T-22b · R-EQ-F1) — GET /api/equipment/locate?q= */
    locate: (q: string) =>
      request<EquipmentLocateResponse>(`/api/equipment/locate?q=${encodeURIComponent(q)}`),
    /**
     * Damaged-at-check-in report (T-24c · R-EQ-F3) — POST /api/equipment/:id/damage.
     * The route (T-24b) writes a `vt_damage_events` row and flips the
     * equipment's `conditionStatus`. `equipmentId` is the path param; the
     * request body carries only the optional `note`.
     */
    reportDamage: ({ equipmentId, note }: CreateDamageReportRequest) =>
      request<CreateDamageReportResponse>(
        `/api/equipment/${encodeURIComponent(equipmentId)}/damage`,
        {
          method: "POST",
          body: JSON.stringify({ note }),
        },
      ),
    confirmInRoom: (id: string, body: { roomId: string }) =>
      request<{ equipmentId: string; roomId: string; roomName: string; status: string }>(
        `/api/equipment/${encodeURIComponent(id)}/confirm-in-room`,
        { method: "POST", body: JSON.stringify(body) },
      ),
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
    /**
     * NFC / deep-link toggle — online-only single POST /toggle.
     */
    quickToggle: async (equipmentId: string): Promise<QuickScanToggleResult> => {
      try {
        const result = await request<{
          equipment: Equipment;
          action: QuickScanToggleAction;
          scanLogId: string;
          undoToken: string;
          checkedOutByEmail?: string;
        }>(`/api/equipment/${equipmentId}/toggle`, {
          method: "POST",
          body: JSON.stringify({ isPluggedIn: true }),
        });

        await updateCachedEquipment(equipmentId, result.equipment).catch(() => {});

        return {
          equipment: result.equipment,
          action: result.action,
          scanLogId: result.scanLogId ?? "",
          undoToken: result.undoToken ?? "",
          checkedOutByEmail: result.checkedOutByEmail,
        };
      } catch (err) {
        if (isNetworkError(err)) {
          throw err;
        }
        if (err instanceof ApiError && err.status === 409) {
          const code =
            typeof err.payload.code === "string"
              ? err.payload.code
              : typeof err.payload.reason === "string"
                ? err.payload.reason
                : "";
          if (code === "VERSION_CONFLICT" || code === "CONFLICT") {
            throw err;
          }
        }
        throw err;
      }
    },
    scan: async (id: string, data: ScanEquipmentRequest) => {
      const cached = await getCachedEquipmentById(id);
      const now = new Date().toISOString();
      const clientTimestamp = Date.now();
      const scanBody: { status: ScanEquipmentRequest["status"]; note?: string; photoUrl?: string } = {
        status: data.status,
        ...(data.note !== undefined && data.note !== "" ? { note: data.note } : {}),
        ...(data.photoUrl ? { photoUrl: data.photoUrl } : {}),
      };

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
        userId: getCurrentUserId(),
        userEmail: getCurrentUserEmail(),
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
            body: JSON.stringify(scanBody),
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
            body: JSON.stringify(scanBody),
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
    logsAdmin: async (
      id: string,
      since?: string
    ): Promise<{ items: ScanLog[]; total: number; page: number; pageSize: number; hasMore: boolean }> => {
      const params = new URLSearchParams({ limit: "200" });
      if (since) params.set("since", since);
      return request<{ items: ScanLog[]; total: number; page: number; pageSize: number; hasMore: boolean }>(
        `/api/equipment/${id}/logs?${params}`
      );
    },
    transfers: (id: string) =>
      requestWithOfflineFallback<TransferLog[]>(
        `/api/equipment/${id}/transfers`,
        () => Promise.resolve([])
      ),
    listDeleted: () => request<DeletedEquipment[]>("/api/equipment/deleted"),
    restore: (id: string) => request<Equipment>(`/api/equipment/${id}/restore`, { method: "POST" }),
    waitlist: (id: string) =>
      request<EquipmentWaitlistSnapshot>(`/api/equipment/${id}/waitlist`),
    joinWaitlist: (id: string) =>
      request<EquipmentWaitlistSnapshot>(`/api/equipment/${id}/waitlist`, { method: "POST" }),
    leaveWaitlist: (id: string) =>
      request<EquipmentWaitlistSnapshot>(`/api/equipment/${id}/waitlist`, { method: "DELETE" }),
    copilotExplain: (id: string) =>
      request<CopilotExplainResponse>(
        `/api/equipment/${encodeURIComponent(id)}/copilot/explain`,
        { method: "POST" },
      ),
};

export type EquipmentApi = typeof equipmentApi;
