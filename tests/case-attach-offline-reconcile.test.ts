/**
 * VetTrack 2.0 — Case Spine spike (task 0.2), client offline reconcile.
 *
 * Proves the offline half: an attach-to-case action taken while OFFLINE is
 * queued locally, and on reconnect reconciles to the server through the
 * existing pendingSync queue + sync-engine `processQueue` machinery — exactly
 * once (no loss, no duplication).
 *
 * Follows the OFF-05 pattern (tests/offline-phase-5-sync-engine-state.test.ts):
 * offline-db I/O is mocked, `isOnline` is toggled, `processQueue` is driven
 * directly, and auth/toast/Sentry are stubbed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSync } from "../src/lib/offline-db";

const fetchMock = vi.hoisted(() => vi.fn());
const addPendingSyncMock = vi.hoisted(() => vi.fn<(op: unknown) => Promise<number | undefined>>());
const updatePendingSyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const removePendingSyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPendingSync = vi.hoisted(() => vi.fn<() => Promise<PendingSync[]>>());
const onlineState = vi.hoisted(() => ({ value: true }));

vi.mock("../src/lib/offline-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/offline-db")>();
  return {
    ...actual,
    addPendingSync: addPendingSyncMock,
    getPendingSync: mockGetPendingSync,
    updatePendingSync: updatePendingSyncMock,
    removePendingSync: removePendingSyncMock,
    runStartupCleanup: vi.fn().mockResolvedValue(undefined),
    recoverProcessingPendingSync: vi.fn().mockResolvedValue(0),
  };
});

vi.mock("../src/lib/safe-browser", () => ({ isOnline: () => onlineState.value }));
vi.mock("../src/lib/auth-store", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer case-spine-spike" }),
  getCurrentUserId: () => "case-spine-spike-user",
  getCurrentClinicId: () => "clinic-a",
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

import { queueCaseAttachIfOffline, buildCaseAttachEndpoint } from "../src/lib/case-attach-offline";
import { clearHaltQueue, processQueue, setAuthStateRef } from "../src/lib/sync-engine";

const CASE_ID = "case-1";
const DISPENSE_ID = "disp-1";
const CLINIC_ID = "clinic-a";

function buildQueuedRow(): PendingSync {
  const now = new Date();
  return {
    id: 101,
    type: "case_attach",
    endpoint: buildCaseAttachEndpoint(CASE_ID),
    method: "POST",
    body: JSON.stringify({ dispenseEventId: DISPENSE_ID, clinicId: CLINIC_ID }),
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
  };
}

describe("case-spine spike — offline attach queues then reconciles once", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    addPendingSyncMock.mockReset().mockResolvedValue(101);
    updatePendingSyncMock.mockClear();
    removePendingSyncMock.mockClear();
    mockGetPendingSync.mockReset();
    onlineState.value = true;
    vi.stubGlobal("fetch", fetchMock);
    clearHaltQueue();
    setAuthStateRef(() => ({ isSignedIn: true, isOfflineSession: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("while offline, the attach action is queued locally (not sent)", async () => {
    onlineState.value = false;

    const outcome = await queueCaseAttachIfOffline({
      caseId: CASE_ID,
      dispenseEventId: DISPENSE_ID,
      clinicId: CLINIC_ID,
    });

    expect(outcome).toEqual({ mode: "queued", pendingId: 101 });
    expect(addPendingSyncMock).toHaveBeenCalledTimes(1);
    const enqueued = addPendingSyncMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enqueued.type).toBe("case_attach");
    expect(enqueued.endpoint).toBe(`/api/cases/${CASE_ID}/attachments`);
    expect(enqueued.method).toBe("POST");
    expect(JSON.parse(enqueued.body as string)).toEqual({
      dispenseEventId: DISPENSE_ID,
      clinicId: CLINIC_ID,
    });
    // Offline: nothing was sent over the wire.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on reconnect, processQueue reconciles the queued attach exactly once", async () => {
    // Went online; the queued row is now visible to the sync engine.
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    mockGetPendingSync.mockResolvedValueOnce([buildQueuedRow()]);

    await processQueue();

    // Reconciled to the server exactly once — no duplication.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/api/cases/${CASE_ID}/attachments`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      dispenseEventId: DISPENSE_ID,
      clinicId: CLINIC_ID,
    });

    // Row transitioned to synced (no loss) and is scheduled for removal.
    const statuses = updatePendingSyncMock.mock.calls.map((c) => c[1]?.status);
    expect(statuses).toContain("processing");
    expect(statuses).toContain("synced");
  });
});
