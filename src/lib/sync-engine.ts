import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { t } from "./i18n";
import {
  getPendingSync,
  updatePendingSync,
  removePendingSync,
  runStartupCleanup,
  recoverProcessingPendingSync,
  PENDING_SYNC_MAX_RETRIES,
  type PendingSync,
  type PendingSyncConflictPayload,
} from "./offline-db";
import { getAuthHeaders } from "./auth-store";
import { clearOfflineSession } from "./offline-session";
import { addConflict, ensureConflictsHydrated, persistConflictPayload } from "./conflict-store";
import { isOnline } from "./safe-browser";

const MAX_RETRIES = PENDING_SYNC_MAX_RETRIES;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const BURST_LIMIT = 50;
const BURST_DELAY_MS = 500;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 20_000;
const ITEM_TIMEOUT_MS = 30_000;

type SyncListener = () => void;
const listeners: Set<SyncListener> = new Set();

export function onSyncStateChange(fn: SyncListener) {
  listeners?.add(fn);
  return () => {
    listeners?.delete(fn);
  };
}

function notifyListeners() {
  listeners?.forEach((fn) => fn());
}

let syncing = false;
let queryClientRef: QueryClient | undefined;
let haltQueue = false;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let circuitResetTimerId: ReturnType<typeof setTimeout> | null = null;

let batchCurrent = 0;
let batchTotal = 0;
let runTotal = 0;
let isInRun = false;

type AuthStateGetter = () => { isSignedIn: boolean; isOfflineSession: boolean } | null;
let authStateGetter: AuthStateGetter | null = null;

export function setAuthStateRef(getter: AuthStateGetter) {
  authStateGetter = getter;
}

export function clearHaltQueue() {
  haltQueue = false;
}

export function getSyncProgress() {
  return {
    isSyncing: syncing,
    batchCurrent,
    batchTotal,
    isCircuitOpen: Date.now() < circuitOpenUntil,
    circuitResetsAt: circuitOpenUntil,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function jitteredDelay(base: number): number {
  return Math.round(base * (1 + Math.random() * 0.5));
}

function openCircuit() {
  consecutiveFailures = 0;
  circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  notifyListeners();

  toast.warning(t.syncEngine.pausedTooManyErrors, {
    description: `Will automatically retry in ${CIRCUIT_COOLDOWN_MS / 1000}s.`,
    duration: 8000,
  });

  if (circuitResetTimerId) clearTimeout(circuitResetTimerId);
  circuitResetTimerId = setTimeout(() => {
    circuitResetTimerId = null;
    notifyListeners();
    toast.success(t.syncEngine.resumedTryingPending, { duration: 3000 });
    if (isOnline() && !haltQueue) processQueue().catch(() => {});
  }, CIRCUIT_COOLDOWN_MS);
}

export async function processQueue(): Promise<void> {
  if (syncing || !isOnline()) return;

  if (Date.now() < circuitOpenUntil) {
    notifyListeners();
    return;
  }

  if (haltQueue) return;

  if (!authStateGetter) return;
  const authSnap = authStateGetter();
  if (!authSnap?.isSignedIn || authSnap.isOfflineSession) return;
  const authHeaders = getAuthHeaders();
  if (!authHeaders.Authorization) return;

  syncing = true;
  notifyListeners();

  try {
    const allPending = await getPendingSync();
    if (allPending.length === 0) {
      isInRun = false;
      runTotal = 0;
      return;
    }

    if (!isInRun) {
      isInRun = true;
      runTotal = allPending.length;
    }

    batchTotal = runTotal;
    batchCurrent = Math.max(0, runTotal - allPending.length);

    const burst = allPending.slice(0, BURST_LIMIT);
    const hasMore = allPending.length > BURST_LIMIT;

    for (const item of burst) {
      if (haltQueue) break;
      if (Date.now() < circuitOpenUntil) break;

      const result = await processSingleItemWithRetry(item);

      if (result === "success") {
        consecutiveFailures = 0;
      } else if (result === "transient_failure") {
        consecutiveFailures++;
        if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
          openCircuit();
          break;
        }
      } else if (result === "auth_halt") {
        break;
      } else if (result === "permission_error" || result === "client_error" || result === "conflict") {
        consecutiveFailures = 0;
      }

      batchCurrent++;
      notifyListeners();
    }

    if (hasMore && !haltQueue && Date.now() >= circuitOpenUntil) {
      setTimeout(() => processQueue(), BURST_DELAY_MS);
    } else {
      isInRun = false;
      runTotal = 0;
    }

    if (queryClientRef && !haltQueue) {
      queryClientRef.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClientRef.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      queryClientRef.invalidateQueries({ queryKey: ["/api/equipment/paginated"] });
      const processedIds = burst
        .map((item) => extractEquipmentId(item.endpoint))
        .filter((id): id is string => !!id);
      const uniqueIds = [...new Set(processedIds)];
      for (const id of uniqueIds) {
        queryClientRef.invalidateQueries({ queryKey: [`/api/equipment/${id}`] });
        queryClientRef.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });
      }
    }
  } finally {
    syncing = false;
    if (!isInRun) {
      batchCurrent = 0;
      batchTotal = 0;
    }
    notifyListeners();
  }
}

function extractEquipmentId(endpoint: string): string | null {
  const match = endpoint.match(/\/api\/equipment\/([^/]+)/);
  return match ? match[1] : null;
}

type ItemResult = "success" | "conflict" | "auth_halt" | "permission_error" | "client_error" | "transient_failure";

async function processSingleItemWithRetry(item: PendingSync): Promise<ItemResult> {
  if (!item.id) return "transient_failure";

  let currentRetries = item.retries || 0;
  let lastResult: ItemResult = "transient_failure";

  while (currentRetries < MAX_RETRIES && isOnline() && !haltQueue) {
    const result = await attemptSync(item);
    lastResult = result;

    if (result === "success") {
      try { await updatePendingSync(item.id, { status: "synced" }); } catch {}
      setTimeout(() => removePendingSync(item.id!), 3000);
      return "success";
    }

    if (
      result === "conflict" ||
      result === "auth_halt" ||
      result === "client_error" ||
      result === "permission_error"
    ) {
      return result;
    }

    currentRetries++;
    try {
      await updatePendingSync(item.id, {
        status: "pending",
        retries: currentRetries,
      });
    } catch {}
    notifyListeners();

    if (currentRetries >= MAX_RETRIES) {
      try {
        await updatePendingSync(item.id, {
          status: "dead",
          retries: currentRetries,
          errorMessage: `Failed after ${MAX_RETRIES} attempts`,
        });
      } catch {}
      // S4 — Report permanent sync failures to Sentry for the 7-day failure rate metric.
      // Sentry.captureEvent is a no-op when VITE_SENTRY_DSN is not configured.
      Sentry.captureEvent({
        message: "Sync permanent failure",
        level: "error",
        tags: { "sync.failure": "true" },
        extra: {
          endpoint: item.endpoint,
          method: item.method,
          itemType: item.type,
          retries: currentRetries,
          errorMessage: `Failed after ${MAX_RETRIES} attempts`,
        },
      });
      // Surface the permanent failure to the operator — previously only
      // Sentry + the Dexie `failed` status recorded it, so a user with no
      // open sync sheet got no feedback that an action was dropped.
      toast.error(t.layout.sync.failedMessage, {
        action: {
          label: t.layout.sync.viewQueue,
          onClick: () => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("vettrack:open-sync-queue"));
            }
          },
        },
      });
      return "transient_failure";
    }

    if (isOnline()) {
      const base = RETRY_DELAYS_MS[currentRetries - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await sleep(jitteredDelay(base));
    } else {
      return "transient_failure";
    }
  }

  return lastResult;
}

async function attemptSync(item: PendingSync): Promise<ItemResult> {
  if (!item.id) return "transient_failure";

  try {
    await updatePendingSync(item.id, { status: "processing" });
  } catch {}

  const liveHeaders = getAuthHeaders();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...liveHeaders,
  };
  if (item.clientTimestamp) headers["X-Client-Timestamp"] = String(item.clientTimestamp);
  const idempotencyKey = item.idempotencyKey?.trim();
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const clientMutationId = item.clientMutationId?.trim();
  if (clientMutationId) headers["X-Client-Mutation-Id"] = clientMutationId;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ITEM_TIMEOUT_MS);
    let res: Response;
    try {
      // Intentional raw fetch: replays the exact queued endpoint/method. Routing
      // through `request()` would re-enter the offline queue and 401 redirect paths.
      res = await fetch(item.endpoint, {
        method: item.method,
        headers,
        body: item.body || undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) {
      return "success";
    }

    if (res.status === 409) {
      const serverData = await res.json().catch(() => ({}));
      const localData = JSON.parse(item.body || "{}");
      const conflictPayload: PendingSyncConflictPayload = {
        serverData,
        localData,
        capturedAt: Date.now(),
      };
      const errorMessage =
        (serverData as Record<string, string>).error ||
        "Conflict: another change was made to this item";

      try {
        await persistConflictPayload(item.id, conflictPayload);
        await updatePendingSync(item.id, { errorMessage });
        addConflict({
          id: item.id!,
          endpoint: item.endpoint,
          method: item.method,
          serverData,
          localData,
        });
      } catch {}

      return "conflict";
    }

    if (res.status === 401) {
      haltQueue = true;
      clearOfflineSession();
      if (queryClientRef) queryClientRef.clear();
      // Non-retryable client error — terminal `dead` (operator must re-auth / discard).
      await updatePendingSync(item.id, {
        status: "dead",
        errorMessage: "Auth error — please sign in again",
      });
      toast.error(t.syncEngine.sessionExpiredSignInAgain, {
        description: "Your pending changes were saved and will sync after you sign in.",
        duration: 10_000,
      });
      return "auth_halt";
    }

    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || `Permission denied: ${res.status}`;
      Sentry.captureMessage("Sync 403 permission denied", {
        level: "warning",
        extra: {
          endpoint: item.endpoint,
          method: item.method,
          itemType: item.type,
          error: errMsg,
        },
      });
      console.error("[sync] 403 permission denied:", item.endpoint, errMsg);
      // Non-retryable 4xx — terminal `dead` (not `failed`; `failed` is retryable-only).
      await updatePendingSync(item.id, {
        status: "dead",
        errorMessage: errMsg,
      });
      return "permission_error";
    }

    if (res.status >= 400 && res.status < 500) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || `Request failed: ${res.status}`;
      console.error("[sync] client error:", item.endpoint, res.status, errMsg);
      await updatePendingSync(item.id, {
        status: "dead",
        errorMessage: errMsg,
      });
      return "client_error";
    }

    return "transient_failure";
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    if (!isAbort) {
      console.error("[sync] network error:", item.endpoint, err);
      Sentry.captureException(err, {
        extra: { endpoint: item.endpoint, method: item.method, itemType: item.type },
      });
    }
    return "transient_failure";
  }
}

export function initSyncEngine(queryClient?: QueryClient) {
  queryClientRef = queryClient;

  const handleOnline = () => {
    processQueue();
  };

  window.addEventListener("online", handleOnline);

  // Order: recover in-flight claims → hydrate conflicts → cleanup → first replay.
  // Do not call processQueue() before recovery completes — getPendingSync() only
  // sees `pending` rows; recovered claims would be missed on the first pass.
  void recoverProcessingPendingSync()
    .then(() => ensureConflictsHydrated())
    .then(() => runStartupCleanup(queryClient))
    .then(() => {
      if (isOnline()) {
        processQueue();
      }
    })
    .catch(() => {});

  return () => {
    window.removeEventListener("online", handleOnline);
  };
}
