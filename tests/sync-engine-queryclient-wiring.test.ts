/**
 * @vitest-environment happy-dom
 *
 * T-05 / R-SY-01 (CLICK-PATH-006) — the sole caller `initSyncEngine()` in
 * `src/hooks/use-sync.tsx` must forward the app QueryClient. Without it,
 * `queryClientRef` in `src/lib/sync-engine.ts` stays `undefined` and three
 * consumer branches silently no-op: the post-replay equipment invalidation
 * (processQueueBody), Phase 9 reconciliation, and the 401 cache-clear branch.
 */
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PendingSync } from "../src/lib/offline-db";

const mockGetPendingSync = vi.hoisted(() => vi.fn<() => Promise<PendingSync[]>>());
const mockRunStartupCleanup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("dexie", () => ({
  liveQuery: (querier: () => unknown) => ({
    subscribe: ({ next }: { next: (v: unknown) => void; error?: (e: unknown) => void }) => {
      Promise.resolve(querier()).then((v) => next(v));
      return { unsubscribe: () => {} };
    },
  }),
}));

vi.mock("../src/lib/offline-db", () => ({
  offlineDb: {
    pendingSync: {
      orderBy: () => ({ toArray: async () => [] }),
    },
  },
  getPendingSync: mockGetPendingSync,
  updatePendingSync: vi.fn().mockResolvedValue(undefined),
  removePendingSync: vi.fn().mockResolvedValue(undefined),
  runStartupCleanup: mockRunStartupCleanup,
  recoverProcessingPendingSync: vi.fn().mockResolvedValue(0),
  PENDING_SYNC_MAX_RETRIES: 5,
  PENDING_SYNC_SCHEMA_VERSION: 2,
}));

vi.mock("../src/lib/safe-browser", () => ({
  isOnline: vi.fn(() => true),
}));

vi.mock("../src/lib/auth-store", () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: "Bearer wiring-test-jwt" })),
  getCurrentUserId: vi.fn(() => "wiring-test-user"),
  getCurrentClinicId: vi.fn(() => "wiring-test-clinic"),
  getStoredBearerToken: vi.fn(() => "wiring-test-jwt"),
}));

vi.mock("../src/lib/offline-sync-telemetry-reporter", () => ({
  maybeReportOfflineSyncTelemetry: vi.fn().mockResolvedValue(undefined),
  MIN_REPORT_INTERVAL_MS: 60_000,
}));
vi.mock("../src/lib/offline-phase9-post-sync-flag", () => ({
  isOfflinePhase9PostSyncReconciliationEnabled: false,
}));

vi.mock("../src/lib/conflict-store", () => ({
  addConflict: vi.fn(),
  removeConflict: vi.fn().mockResolvedValue(undefined),
  ensureConflictsHydrated: vi.fn().mockResolvedValue(undefined),
  persistConflictPayload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/offline-session", () => ({
  clearOfflineSession: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}));

import { SyncProvider } from "../src/hooks/use-sync";
import { clearHaltQueue, getSyncProgress, processQueue, setAuthStateRef } from "../src/lib/sync-engine";

function buildPendingRow(
  overrides: Partial<PendingSync> & Pick<PendingSync, "type" | "endpoint" | "method">,
): PendingSync {
  return {
    id: 1,
    body: "{}",
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: 1_700_000_000_000,
    clientMutationId: "wiring-mutation-id",
    idempotencyKey: "wiring-idempotency-key",
    schemaVersion: 1,
    updatedAt: new Date(),
    structuredError: null,
    ...overrides,
  };
}

function renderSyncProvider(queryClient: QueryClient) {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SyncProvider, null, "wiring-test-child"),
    ),
  );
}

describe("T-05 — SyncProvider must pass the QueryClient into initSyncEngine", () => {
  beforeEach(() => {
    mockGetPendingSync.mockReset();
    mockGetPendingSync.mockResolvedValue([]);
    mockRunStartupCleanup.mockClear();
    clearHaltQueue();
    setAuthStateRef(() => ({ isSignedIn: true, isOfflineSession: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("(1) passes a defined QueryClient into initSyncEngine — not undefined", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderSyncProvider(queryClient);

    await vi.waitFor(() => expect(mockRunStartupCleanup).toHaveBeenCalled());

    // runStartupCleanup(queryClient) is called from inside initSyncEngine with
    // exactly the argument use-sync.tsx forwarded. If use-sync.tsx calls
    // initSyncEngine() with no argument, this is `undefined`.
    const receivedArg = mockRunStartupCleanup.mock.calls[0]?.[0];
    expect(receivedArg).toBeDefined();
    expect(receivedArg).toBe(queryClient);
  });

  it("(2) a replayed mutation success invalidates equipment queries (queryClientRef wiring)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );

    renderSyncProvider(queryClient);

    // Wait for initSyncEngine's own startup cycle (empty pending list) to
    // fully settle before driving our own processQueue() call, so the two
    // don't race over the shared module-level `syncing` flag.
    await vi.waitFor(() => {
      expect(mockGetPendingSync).toHaveBeenCalled();
      expect(getSyncProgress().isSyncing).toBe(false);
    });

    mockGetPendingSync.mockResolvedValueOnce([
      buildPendingRow({
        type: "checkout",
        method: "POST",
        endpoint: "/api/equipment/eq-wire-1/checkout",
      }),
    ]);

    await processQueue();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/equipment"] });
  });

  it("(3) a 401 during replay clears the QueryClient cache (queryClientRef wiring)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["/api/equipment"], [{ id: "stale" }]);
    const clearSpy = vi.spyOn(queryClient, "clear");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    renderSyncProvider(queryClient);

    await vi.waitFor(() => {
      expect(mockGetPendingSync).toHaveBeenCalled();
      expect(getSyncProgress().isSyncing).toBe(false);
    });

    mockGetPendingSync.mockResolvedValueOnce([
      buildPendingRow({
        type: "checkout",
        method: "POST",
        endpoint: "/api/equipment/eq-wire-2/checkout",
      }),
    ]);

    await processQueue();

    expect(clearSpy).toHaveBeenCalled();
  });
});
