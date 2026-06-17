import { resolveApiUrl } from "@/lib/api-origin";
import type {
  EquipmentReturn,
  CreateReturnRequest,
  UpdateReturnRequest,
  InventoryContainer,
  InventoryContainerWithItems,
  ConsumablesReport,
  Folder,
  Room,
  CreateRoomRequest,
  UpdateRoomRequest,
  BulkVerifyRoomResult,
  ActivityFeedItem,
  HomeDashboardPulse,
  AnalyticsSummary,
  User,
  UploadUrlRequest,
  UploadUrlResponse,
  AlertAcknowledgment,
  SystemMetrics,
  SupportTicket,
  CreateSupportTicketRequest,
  CursorBugFixerConfigResponse,
  CursorBugFixerDispatchResponse,
  CursorBugFixerAgentSummary,
  CursorBugFixerRunSummary,
  Shift,
  UserRole,
  ShiftRole,
  ShiftImport,
  ShiftImportPreview,
  ShiftImportResult,
  Appointment,
  AppointmentVetMeta,
  CreateAppointmentRequest,
  UpdateAppointmentRequest,
  TaskDashboard,
  TaskRecommendations,
  CrashCartItem,
  CreateCrashCartItemRequest,
  UpdateCrashCartItemRequest,
  RestockSession,
  RestockContainerView,
  RestockFinishSummary,
  InventoryItem,
  PurchaseOrder,
  DisplaySnapshot,
  CodeBlueDispense,
  ShiftCompletionResult,
  AssetType,
  AssetTypeCondition,
  UnitConditionState,
  StagingClaim,
  DeployabilityResponse,
  Dock,
  OperationalMetricsSummary,
} from "@/types";
import type { OutcomeKpiRoiResponse } from "../../shared/er-types.js";
import type { AuthoritySnapshot } from "../../shared/authority.js";
import { getStoredLocale, t } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getCachedFolders,
  getCachedRooms,
  getCachedRoomById,
  cacheFolders,
  cacheRooms,
} from "./offline-db";
import { equipmentApi, requestWithOfflineFallback, type EquipmentPage } from "./api/equipment";
import {
  request,
  ApiError,
  TimeoutError,
  OfflineResponseError,
  fetchWithTimeout,
  mergeRequestHeaders,
  extractApiErrorCode,
  toApiErrorMessage,
  isNetworkError,
  throwIfUnauthorized,
  FETCH_TIMEOUT_MS,
  EQUIPMENT_LIST_FETCH_TIMEOUT_MS,
  TASKS_FETCH_TIMEOUT_MS,
} from "./request-core";

/** Compatibility re-exports (Slice 1 — request core extracted). */
export {
  request,
  ApiError,
  EQUIPMENT_LIST_FETCH_TIMEOUT_MS,
  TASKS_FETCH_TIMEOUT_MS,
};

/** Compatibility re-export (Slice 3 — equipment module). */
export type { EquipmentPage };

const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;

/**
 * Raw fetch with timeout — bypasses authFetch intentionally.
 *
 * Auth bootstrap calls (/api/users/me, /api/users/sync) must NOT go through
 * authFetch because:
 *   1. authFetch gates on `getCurrentUserId()` being non-empty, but userId is
 *      always "" in authStore at the time the first bootstrap call fires (before
 *      the server response populates it). This throws AUTH_INVALID and puts the
 *      client into the catch-branch, which shows the "pending" screen as a false
 *      positive even when the DB user is fully active.
 *   2. authFetch throws on 401 responses, but the bootstrap flow needs raw 401
 *      so it can fall through to POST /api/users/sync to provision new users.
 *
 * The caller (use-auth.tsx syncSession) already constructs the correct
 * Authorization header before calling these functions, so no auth logic is lost.
 */
function bootstrapFetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const outer = init.signal as AbortSignal | undefined | null;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AUTH_BOOTSTRAP_TIMEOUT_MS);

  if (outer) {
    const onAbort = () => controller.abort();
    outer.addEventListener("abort", onAbort, { once: true });
    controller.signal.addEventListener("abort", () => outer.removeEventListener("abort", onAbort), { once: true });
  }

  return fetch(resolveApiUrl(url), { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      if (timedOut && err instanceof DOMException && err.name === "AbortError") {
        throw new TimeoutError(AUTH_BOOTSTRAP_TIMEOUT_MS);
      }
      throw err;
    });
}

/**
 * Auth bootstrap helpers — return raw `Response` so `use-auth` can branch on
 * 401/404 before session is established without triggering mutation 401 redirects.
 *
 * Uses bootstrapFetchWithTimeout (raw fetch) instead of the authenticated
 * fetchWithTimeout to avoid the authFetch userId guard that fires before the
 * server response has populated authStore.userId.
 */
export async function authFetchUsersMe(init: RequestInit = {}): Promise<Response> {
  return bootstrapFetchWithTimeout(
    "/api/users/me",
    { credentials: "include", ...init, headers: mergeRequestHeaders(init) },
  );
}

export async function authPostUsersSync(
  body: { clerkId: string; email: string; name: string },
  init: RequestInit = {},
): Promise<Response> {
  const payload = JSON.stringify(body);
  return bootstrapFetchWithTimeout(
    "/api/users/sync",
    {
      credentials: "include",
      method: "POST",
      ...init,
      headers: mergeRequestHeaders({ ...init, body: payload }),
      body: payload,
    },
  );
}

export interface DeleteAccountResult {
  success: boolean;
  /** Whether the user's Sign in with Apple token was revoked at Apple. */
  appleRevocation: "revoked" | "failed" | "skipped";
  /** Whether the DB row was hard-deleted or kept as an anonymized tombstone. */
  dbOutcome: "hard_deleted" | "anonymized";
  clerkDeleted: boolean;
}

/**
 * Permanently delete the current user's own account (App Store Guideline
 * 5.1.1(v)). The caller must sign out and redirect on success.
 */
export async function deleteOwnAccount(): Promise<DeleteAccountResult> {
  return request<DeleteAccountResult>("/api/users/delete-account", { method: "DELETE" });
}

/**
 * Link a Sign in with Apple `authorizationCode` so the server can revoke the
 * user's Apple tokens at deletion time. Best-effort: callers ignore failures.
 */
export async function linkAppleAuthorizationCode(authorizationCode: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/users/apple-link", {
    method: "POST",
    body: JSON.stringify({ authorizationCode }),
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
    throwIfUnauthorized(res, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

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

export const api = {
  equipment: equipmentApi,
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
  home: {
    dashboard: () => request<HomeDashboardPulse>("/api/home/dashboard"),
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
    start: (id: string) =>
      request<{ task: Appointment }>(`/api/tasks/${id}/start`, { method: "POST" }).then((r) => r.task),
    complete: (id: string) =>
      request<{ task: Appointment }>(`/api/tasks/${id}/complete`, { method: "POST" }).then((r) => r.task),
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
  cursorBugFixer: {
    getConfig: () =>
      request<CursorBugFixerConfigResponse>("/api/admin/cursor-bug-fixer/config"),
    dispatchFromTicket: (ticketId: string) =>
      request<CursorBugFixerDispatchResponse & { supportTicketId?: string }>(
        `/api/admin/cursor-bug-fixer/support-tickets/${ticketId}/dispatch`,
        { method: "POST" },
      ),
    getAgent: (agentId: string) =>
      request<CursorBugFixerAgentSummary>(
        `/api/admin/cursor-bug-fixer/agents/${encodeURIComponent(agentId)}`,
      ),
    getRun: (agentId: string, runId: string) =>
      request<CursorBugFixerRunSummary>(
        `/api/admin/cursor-bug-fixer/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
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
  adminOutboxDlq: {
    list: (params?: { limit?: number; cursor?: number }) => {
      const qs = new URLSearchParams();
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.cursor != null) qs.set("cursor", String(params.cursor));
      const query = qs.toString();
      return request<{
        clinicId: string;
        items: Array<{
          id: number;
          type: string;
          occurredAt: string;
          retryCount: number;
          errorType: string | null;
          lastAttemptAt: string | null;
          nextAttemptAt: string | null;
        }>;
        nextCursor?: number;
        requestId: string;
      }>(`/api/admin/outbox/dlq${query ? `?${query}` : ""}`);
    },
    retryAll: (body?: { force?: boolean }) =>
      request<{
        clinicId: string;
        resetCount: number;
        requestId: string;
      }>("/api/admin/outbox/dlq/retry", {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    drop: (ids: number[]) =>
      request<{
        clinicId: string;
        deletedCount: number;
        deletedIds: number[];
        skippedIds: number[];
        requestId: string;
      }>("/api/admin/outbox/dlq/drop", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
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
  codeBlue: {
    /** Active session poll + emergency session mutations (via `request()` / offline doctrine). */
    sessions: {
      getActive: () =>
        request<import("@/hooks/useCodeBlueSession").SessionPollResult>(
          "/api/code-blue/sessions/active",
        ),
      start: (body: {
        idempotencyKey: string;
        managerUserId: string;
        managerUserName: string;
        preCheckPassed: boolean;
        equipmentId?: string;
      }) =>
        request<{ id: string }>("/api/code-blue/sessions", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      end: (sessionId: string, body: { outcome: string }) =>
        request<{ ok?: boolean }>(`/api/code-blue/sessions/${sessionId}/end`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      appendLog: (
        sessionId: string,
        body: {
          idempotencyKey: string;
          elapsedMs: number;
          label: string;
          category: "equipment" | "note";
          equipmentId?: string;
        },
      ) =>
        request<{ id: string }>(`/api/code-blue/sessions/${sessionId}/logs`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      sendPresence: (sessionId: string) =>
        request<void>(`/api/code-blue/sessions/${sessionId}/presence`, {
          method: "PATCH",
        }, undefined, true),
    },
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
  },
  display: {
    snapshot: (): Promise<DisplaySnapshot> =>
      request<DisplaySnapshot>("/api/display/snapshot"),
    // Phase 9 PR 9.2 — operational liveness heartbeat. Never used as input to
    // any clinical, authority, audit, billing, or enforcement decision.
    //
    // Payload is intentionally minimal — only fields the server actually
    // reads. The handler reads `displaySessionId` (rate-limit/coalescing
    // key) and `kioskMode` (bounded-enum counter routing); transmitting
    // anything else would waste bytes on a 30-s polling path with no
    // server-side consumer.
    heartbeat: (body: {
      displaySessionId: string;
      kioskMode: boolean;
    }): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>("/api/display/heartbeat", {
        method: "POST",
        body: JSON.stringify(body),
      }),
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
    telemetry: (body: {
      duplicateDrop?: boolean;
      gapResync?: boolean;
      // Phase 9 PR 9.4 — bounded enum buckets only.
      codeBluePropagationBucket?: "lt_1s" | "lt_3s" | "lt_15s" | "gte_15s";
      codeBlueWakeRecovery?: boolean;
      codeBlueSnapshotFallback?: boolean;
      emergencyDegradedEntered?: boolean;
      emergencyDegradedRecovered?: boolean;
      // Phase 9 PR 9.5 — bounded enum: which Code Blue endpoint class was
      // blocked offline. The sessionStorage buffer itself is NEVER posted.
      offlineEmergencyMutationBlocked?: "start" | "log" | "end" | "presence";
      // Phase 9 PR 9.7 — bounded enum telemetry fields.
      displayForcedResyncTrigger?:
        | "visibility"
        | "pageshow"
        | "online"
        | "version_mismatch"
        | "gap"
        | "peer_ahead"
        | "emergency_uncertain";
      splitVersionClientDetected?: boolean;
      swUpdateConflict?: boolean;
      swForcedReloadSurface?: "active" | "idle" | "kiosk";
      swForcedReloadLoopSuppressed?: boolean;
      // Phase 9 PR 9.2 — wake-lock reacquire budget exhaustion. Bounded
      // boolean; bumps `display_wake_lock_reacquire_exhausted` once per
      // exhaustion event (the hook itself enforces one-shot semantics via
      // the `exhaustedLogged` flag).
      displayWakeLockReacquireExhausted?: boolean;
      // OFF-08 — bounded offline Dexie queue aggregates (no PII / per-row labels).
      offlineSyncPendingCountBucket?: "0" | "1" | "2_5" | "6_plus";
      offlineSyncOldestPendingAgeBucket?: "none" | "lt_60s" | "lt_5m" | "lt_1h" | "gte_1h";
      offlineSyncDeadLetterBucket?: "0" | "1" | "2_plus";
      offlineSyncConflictBucket?: "0" | "1_plus";
      offlineSyncSessionSuccessBucket?: "0" | "1_5" | "6_plus";
      offlineSyncSessionConflictBucket?: "0" | "1_5" | "6_plus";
      offlineSyncSessionDeadBucket?: "0" | "1_5" | "6_plus";
      /** SYNC-TEL — event-driven sync engine signals (strict booleans). */
      syncPermanentFailure?: boolean;
      syncCircuitOpen?: boolean;
    }) =>
      request<{ ok: boolean }>("/api/realtime/telemetry", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  operationalState: {
    listAssetTypes: () =>
      request<AssetType[]>("/api/asset-types"),
    createAssetType: (data: { name: string }) =>
      request<AssetType>("/api/asset-types", { method: "POST", body: JSON.stringify(data) }),
    listConditions: (assetTypeId: string) =>
      request<AssetTypeCondition[]>(`/api/asset-types/${assetTypeId}/conditions`),
    createCondition: (
      assetTypeId: string,
      data: { conditionName: string; verificationMethod: string; staleAfterMinutes: number; displayOrder?: number },
    ) =>
      request<AssetTypeCondition>(`/api/asset-types/${assetTypeId}/conditions`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    listDocks: () =>
      request<Dock[]>("/api/docks"),
    createDock: (data: { name: string; description?: string; roomId?: string }) =>
      request<Dock>("/api/docks", { method: "POST", body: JSON.stringify(data) }),
    deployability: (id: string) =>
      request<DeployabilityResponse>(`/api/equipment/${id}/deployability`),
    conditionStates: (id: string) =>
      request<UnitConditionState[]>(`/api/equipment/${id}/condition-states`),
    dockReturn: (
      id: string,
      data: {
        dockId?: string;
        masterNfcTagId?: string;
        conditionVerifications: { conditionId: string; verified: boolean; notes?: string }[];
      },
    ) =>
      request<{ equipmentId: string; readinessState: string; custodyState: string }>(
        `/api/equipment/${id}/dock-return`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    stage: (
      id: string,
      data: { clinicalPriority: "routine" | "urgent" | "emergency"; notes?: string; emergencyStage?: boolean },
    ) =>
      request<StagingClaim>(`/api/equipment/${id}/stage`, { method: "POST", body: JSON.stringify(data) }),
    cancelStage: (id: string, claimId: string) =>
      request<void>(`/api/equipment/${id}/stage/${claimId}`, { method: "DELETE" }),
    stagingQueue: (id: string) =>
      request<StagingClaim[]>(`/api/equipment/${id}/staging-queue`),
    procedureBind: (id: string, data: { hospitalizationId: string }) =>
      request<{ ok: boolean; equipment: { id: string; usageState: string; readinessState: string; version: number } }>(
        `/api/equipment/${id}/procedure-bind`,
        { method: "POST", body: JSON.stringify(data) },
      ),
    procedureUnbind: (id: string) =>
      request<{ ok: boolean; equipment: { id: string; usageState: string; readinessState: string; version: number } }>(
        `/api/equipment/${id}/procedure-bind`,
        { method: "DELETE" },
      ),
    metricsSummary: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return request<OperationalMetricsSummary>(`/api/operational-metrics/summary${query}`);
    },
  },
  platform: {
    capabilities: () =>
      request<{
        clinicalApi: boolean;
        dispenseApi: boolean;
        shiftChatApi: boolean;
        broadInventory: boolean;
        broadProcurement: boolean;
        assetCopilot: boolean;
        cursorBugFixer: boolean;
      }>("/api/platform/capabilities"),
  },
};
