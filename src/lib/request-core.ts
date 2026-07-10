/**
 * Shared HTTP client for VetTrack API calls (Slice 1).
 * Extracted from api.ts to break the api ↔ er-api import cycle.
 */
import { getStoredLocale, t } from "@/lib/i18n";
import { toast } from "sonner";
import type { PendingSyncType } from "./offline-db";
import {
  addPendingSync,
  getCachedEquipmentById,
  updateCachedEquipment,
} from "./offline-db";
import {
  classifyEmergencyEndpoint,
  recordEmergencyBlockLocally,
} from "@/lib/offline-emergency-block";
import { OfflineEmergencyMutationBlockedError } from "@/lib/offline-policy";
import { authFetch } from "./auth-fetch";
import { navigate } from "wouter/use-browser-location";
import { isOnline } from "./safe-browser";

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

export function buildHeaders(): Record<string, string> {
  return { ...BASE_HEADERS, "X-Locale": getStoredLocale() };
}

/** Multipart uploads must not send `Content-Type: application/json` so the boundary is preserved. */
export function mergeRequestHeaders(init: RequestInit): Record<string, string> {
  const merged: Record<string, string> = {
    ...buildHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (typeof FormData !== "undefined" && init.body instanceof FormData) {
    delete merged["Content-Type"];
  }
  return merged;
}

export interface OfflineRequestOptions {
  offlineType: PendingSyncType;
  offlineEquipmentId?: string;
  optimisticResult?: unknown;
}

export interface ApiErrorPayload {
  code?: string;
  error?: string;
  reason?: string;
  message?: string;
  requestId?: string;
}

/** Error codes may be top-level (`error`, `code`) or nested (`data.code`) depending on handler. */
export function extractApiErrorCode(json: ApiErrorPayload & Record<string, unknown>): string {
  if (typeof json.error === "string" && json.error) return json.error;
  if (typeof json.code === "string" && json.code) return json.code;
  const data = json.data;
  if (data && typeof data === "object" && data !== null && "code" in data) {
    const c = (data as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return "UNKNOWN";
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export class OfflineResponseError extends Error {
  constructor() {
    super("Offline response received");
    this.name = "OfflineResponseError";
  }
}

/**
 * Error thrown by `request` for non-2xx responses.
 * Preserves the server's error `code` and any structured fields.
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

/**
 * Phase 9 PR 9.5 — best-effort telemetry for offline emergency-block events.
 * Exported for optimistic mutation path in api.ts.
 */
export function reportEmergencyBlockedSilently(
  endpointClass: "start" | "log" | "end" | "presence",
): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return;
  }
  void request<{ ok: boolean }>(
    "/api/realtime/telemetry",
    {
      method: "POST",
      body: JSON.stringify({ offlineEmergencyMutationBlocked: endpointClass }),
    },
    undefined,
    true,
  ).catch(() => {});
}

export function isOfflineResponse(status: number, payload: unknown): boolean {
  if (status !== 503) return false;
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as { offline?: unknown; error?: unknown };
  if (candidate.offline === true) return true;
  return typeof candidate.error === "string" && candidate.error.toLowerCase().includes("network unavailable");
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof OfflineResponseError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (!isOnline()) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.message.includes("Failed to fetch")) return true;
  return false;
}

export const FETCH_TIMEOUT_MS = 30_000;
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

/** Shared 401 handling for `request` and api-layer callers (e.g. container dispense). */
export function throwIfUnauthorized(res: Response, init: RequestInit): void {
  if (res.status !== 401) return;
  const method = String(init.method ?? "GET").toUpperCase();
  if (method === "GET") {
    if (!authRedirectInProgress) {
      authRedirectInProgress = true;
      toast.error(t.api.sessionExpired);
    }
    redirectToSignInSoft();
    throw new Error("Session expired");
  }
  throw new Error("UNAUTHORIZED");
}

export function toApiErrorMessage(status: number, payload: ApiErrorPayload | null): string {
  // User-facing message only — never append the requestId. It's an internal
  // correlation id (leaking it in a toast is bad UX and info disclosure, F2);
  // it stays available programmatically on `ApiError.requestId` for logging.
  return payload?.message || payload?.error || `HTTP ${status}`;
}

export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
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

export async function request<T>(
  url: string,
  init: RequestInit = {},
  offline?: OfflineRequestOptions,
  silent?: boolean,
  timeoutMs?: number,
): Promise<T> {
  const headers = mergeRequestHeaders(init);

  try {
    const res = await fetchWithTimeout(url, { ...init, headers }, timeoutMs ?? FETCH_TIMEOUT_MS);
    throwIfUnauthorized(res, init);
    if (!res.ok) {
      if (!silent && res.status >= 500) {
        toast.error(t.api.serverError, { id: "server-error" });
      }
      const error = (await res.json().catch(() => ({ error: "Request failed" }))) as ApiErrorPayload &
        Record<string, unknown>;
      if (isOfflineResponse(res.status, error)) {
        throw new OfflineResponseError();
      }
      throw new ApiError(res.status, toApiErrorMessage(res.status, error), error);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    if (isNetworkError(err)) {
      const method = (init.method as string) || "GET";
      if (
        (method === "POST" || method === "DELETE") &&
        /^\/api\/equipment\/[^/]+\/waitlist\/?$/.test(url.split("?")[0] ?? url)
      ) {
        if (!silent) {
          toast.error(t.equipmentWaitlist.offlineBlocked);
        }
        throw new Error("EQUIPMENT_WAITLIST_OFFLINE");
      }
      const emergencyClass = classifyEmergencyEndpoint(url, method);
      if (emergencyClass) {
        recordEmergencyBlockLocally(emergencyClass);
        reportEmergencyBlockedSilently(emergencyClass);
        if (!silent) {
          toast.error(t.api.networkUnavailable, { id: `emergency-blocked-${emergencyClass}` });
        }
        throw new OfflineEmergencyMutationBlockedError(emergencyClass);
      }
      if (!silent) {
        toast.error(t.api.networkUnavailable, { id: "network-error" });
      }
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
