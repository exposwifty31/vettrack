/**
 * SYNC-TEL — sync-engine event-driven telemetry (circuit dedupe + permanent failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSync } from "../src/lib/offline-db";
import { PENDING_SYNC_MAX_RETRIES } from "../src/lib/offline-db";
import {
  _resetSyncEngineTelemetryForTests,
  reportSyncCircuitOpen,
  reportSyncPermanentFailure,
  resetSyncCircuitOpenTelemetryIfExpired,
} from "../src/lib/sync-engine-telemetry";
import { clearHaltQueue, processQueue, setAuthStateRef } from "../src/lib/sync-engine";

const telemetryMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("../src/lib/api", () => ({
  api: {
    realtime: {
      telemetry: telemetryMock,
    },
  },
}));

const fetchMock = vi.hoisted(() => vi.fn());
const updatePendingSyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const removePendingSyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPendingSync = vi.hoisted(() => vi.fn<() => Promise<PendingSync[]>>());

vi.mock("../src/lib/offline-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/offline-db")>();
  return {
    ...actual,
    getPendingSync: mockGetPendingSync,
    updatePendingSync: updatePendingSyncMock,
    removePendingSync: removePendingSyncMock,
    runStartupCleanup: vi.fn().mockResolvedValue(undefined),
    recoverProcessingPendingSync: vi.fn().mockResolvedValue(0),
  };
});

vi.mock("../src/lib/safe-browser", () => ({ isOnline: () => true }));
vi.mock("../src/lib/auth-store", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer sync-tel-test" }),
}));
vi.mock("../src/lib/offline-session", () => ({ clearOfflineSession: vi.fn() }));
vi.mock("../src/lib/offline-sync-telemetry-reporter", () => ({
  maybeReportOfflineSyncTelemetry: vi.fn().mockResolvedValue(undefined),
  MIN_REPORT_INTERVAL_MS: 60_000,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
}));

function buildRow(overrides: Partial<PendingSync> & Pick<PendingSync, "id">): PendingSync {
  const now = new Date();
  return {
    type: "scan",
    endpoint: "/api/equipment/eq-sync-tel/scan",
    method: "POST",
    body: "{}",
    createdAt: now,
    retries: 0,
    status: "pending",
    clientTimestamp: now.getTime(),
    clientMutationId: "sync-tel-mutation",
    idempotencyKey: "sync-tel-key",
    schemaVersion: 2,
    updatedAt: now,
    structuredError: null,
    conflictPayload: null,
    ...overrides,
  };
}

describe("SYNC-TEL sync-engine-telemetry module", () => {
  beforeEach(() => {
    telemetryMock.mockClear();
    _resetSyncEngineTelemetryForTests();
  });

  it("posts syncCircuitOpen once per open window", () => {
    const until = Date.now() + 20_000;
    reportSyncCircuitOpen(until);
    reportSyncCircuitOpen(until);
    expect(telemetryMock).toHaveBeenCalledTimes(1);
    expect(telemetryMock).toHaveBeenCalledWith({ syncCircuitOpen: true });
  });

  it("allows a new post after the window expires", () => {
    const until = 1_000;
    reportSyncCircuitOpen(until);
    resetSyncCircuitOpenTelemetryIfExpired(2_000);
    reportSyncCircuitOpen(until + 20_000);
    expect(telemetryMock).toHaveBeenCalledTimes(2);
  });

  it("reportSyncPermanentFailure posts syncPermanentFailure: true", () => {
    reportSyncPermanentFailure();
    expect(telemetryMock).toHaveBeenCalledWith({ syncPermanentFailure: true });
  });
});

describe("SYNC-TEL sync-engine integration", () => {
  beforeEach(() => {
    telemetryMock.mockClear();
    _resetSyncEngineTelemetryForTests();
    fetchMock.mockReset();
    updatePendingSyncMock.mockClear();
    mockGetPendingSync.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearHaltQueue();
    setAuthStateRef(() => ({ isSignedIn: true, isOfflineSession: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "posts permanent failure telemetry when max retries exhaust",
    async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      mockGetPendingSync.mockResolvedValueOnce([buildRow({ id: 99 })]);
      await processQueue();
      expect(telemetryMock).toHaveBeenCalledWith({ syncPermanentFailure: true });
      const deadUpdate = updatePendingSyncMock.mock.calls.find((c) => c[1]?.status === "dead");
      expect(deadUpdate).toBeTruthy();
      expect(fetchMock.mock.calls.length).toBe(PENDING_SYNC_MAX_RETRIES);
    },
    60_000,
  );

  it("posts circuit-open telemetry once when circuit trips", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    const rows = Array.from({ length: 5 }, (_, i) =>
      buildRow({ id: i + 1, retries: PENDING_SYNC_MAX_RETRIES - 1 }),
    );
    mockGetPendingSync.mockResolvedValueOnce(rows);
    await processQueue();
    const circuitCalls = telemetryMock.mock.calls.filter(
      (c) => c[0]?.syncCircuitOpen === true,
    );
    expect(circuitCalls.length).toBe(1);
    const permanentCalls = telemetryMock.mock.calls.filter(
      (c) => c[0]?.syncPermanentFailure === true,
    );
    expect(permanentCalls.length).toBeGreaterThanOrEqual(4);
  });
});
