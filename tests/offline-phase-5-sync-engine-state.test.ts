/**
 * OFF-05 — sync-engine state transitions (mocked Dexie I/O).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSync } from "../src/lib/offline-db";
import { PENDING_SYNC_MAX_RETRIES } from "../src/lib/offline-db";
import {
  clearHaltQueue,
  processQueue,
  setAuthStateRef,
} from "../src/lib/sync-engine";

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
  getAuthHeaders: () => ({ Authorization: "Bearer off-05-test" }),
}));
vi.mock("../src/lib/offline-session", () => ({ clearOfflineSession: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  captureException: vi.fn(),
}));
function buildRow(
  overrides: Partial<PendingSync> & Pick<PendingSync, "endpoint">,
): PendingSync {
  const now = new Date();
  return {
    id: 1,
    type: "scan",
    method: "POST",
    body: "{}",
    createdAt: now,
    retries: 0,
    status: "pending",
    clientTimestamp: now.getTime(),
    clientMutationId: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
    idempotencyKey: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    schemaVersion: 2,
    updatedAt: now,
    structuredError: null,
    conflictPayload: null,
    endpoint: overrides.endpoint,
    ...overrides,
  };
}

describe("offline phase 5 — sync-engine state transitions", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updatePendingSyncMock.mockClear();
    removePendingSyncMock.mockClear();
    mockGetPendingSync.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearHaltQueue();
    setAuthStateRef(() => ({ isSignedIn: true, isOfflineSession: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pending → processing → synced on HTTP 200", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    mockGetPendingSync.mockResolvedValueOnce([
      buildRow({ endpoint: "/api/equipment/eq-1/scan", id: 42 }),
    ]);
    await processQueue();

    const statuses = updatePendingSyncMock.mock.calls.map((c) => c[1]?.status);
    expect(statuses).toContain("processing");
    expect(statuses).toContain("synced");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it(
    "transient failures retry until MAX_RETRIES then dead",
    async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      mockGetPendingSync.mockResolvedValueOnce([
        buildRow({ endpoint: "/api/equipment/eq-2/scan", id: 7 }),
      ]);
      await processQueue();

      const deadUpdate = updatePendingSyncMock.mock.calls.find((c) => c[1]?.status === "dead");
      expect(deadUpdate).toBeTruthy();
      expect(deadUpdate?.[1]?.errorMessage).toContain(String(PENDING_SYNC_MAX_RETRIES));
      const pendingResets = updatePendingSyncMock.mock.calls.filter((c) => c[1]?.status === "pending");
      expect(pendingResets.length).toBeGreaterThan(0);
      expect(fetchMock.mock.calls.length).toBe(PENDING_SYNC_MAX_RETRIES);
    },
    60_000,
  );

  it("HTTP 409 → conflict with persisted payload (not failed)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "version mismatch" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    mockGetPendingSync.mockResolvedValueOnce([
      buildRow({
        endpoint: "/api/equipment/eq-3/scan",
        id: 9,
        body: '{"status":"available"}',
      }),
    ]);
    await processQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const conflictUpdate = updatePendingSyncMock.mock.calls.find(
      (c) => c[1]?.status === "conflict" && c[1]?.conflictPayload,
    );
    expect(conflictUpdate).toBeTruthy();
    expect(conflictUpdate?.[1]?.conflictPayload?.localData).toEqual({ status: "available" });
    expect(conflictUpdate?.[1]?.conflictPayload?.serverData).toEqual({ error: "version mismatch" });
    expect(
      updatePendingSyncMock.mock.calls.some((c) => c[1]?.status === "failed"),
    ).toBe(false);
  });
});
