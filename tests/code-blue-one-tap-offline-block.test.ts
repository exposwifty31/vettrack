/**
 * R-CBF-1.5 — focused offline-block acceptance test for the one-tap
 * orchestration endpoint (`POST /api/code-blue/one-tap`).
 *
 * The R-CBF-1.1 guardrail requires a focused offline test proving the one-tap
 * mutation fails loudly + increments `offline_emergency_mutation_blocked_*`
 * and is NEVER queued for offline replay. The classic Code Blue mutations
 * (start/log/end/presence) are covered by `code-blue-offline-queue-removed.test.ts`;
 * the composed one-tap endpoint is a distinct surface and must carry the same
 * doctrine guarantees. This suite locks them as the R-CBF-1.5 acceptance bar:
 *
 *   1. `classifyEmergencyEndpoint` classifies `POST /api/code-blue/one-tap`
 *      as an emergency `start` mutation (registered in the shared manifest).
 *   2. The typed `api.codeBlue.sessions.oneTap` wrapper — the ONLY sanctioned
 *      client entry point — rejects loudly on a network failure, records to the
 *      tab-local FIFO buffer, and is NEVER enqueued into pendingSync.
 *   3. When the block happens with a reachable server (flaky network, the
 *      browser still reports `navigator.onLine === true`), the bounded
 *      `offlineEmergencyMutationBlocked: "start"` telemetry POST is emitted —
 *      the wire signal that increments `offline_emergency_mutation_blocked_start`
 *      on the server. When truly offline it is NOT posted (can't reach the
 *      server) and the sessionStorage buffer is never sent.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearEmergencyBlockBufferForTests,
  _readEmergencyBlockBufferForTests,
  classifyEmergencyEndpoint,
} from "../src/lib/offline-emergency-block";
import { OfflineEmergencyMutationBlockedError } from "../src/lib/offline-policy";
import {
  getAllPendingSync,
  offlineDb,
} from "../src/lib/offline-db";
import type { OneTapCodeBlueRequest } from "../src/types/safety-surfaces";

const addPendingSyncSpy = vi.hoisted(() => vi.fn());
const authFetchMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/offline-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/offline-db")>();
  return {
    ...actual,
    addPendingSync: (op: Parameters<typeof actual.addPendingSync>[0]) => {
      addPendingSyncSpy(op);
      return actual.addPendingSync(op);
    },
  };
});

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock("../src/lib/auth-fetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

function installSessionStorageShim(): () => void {
  const map = new Map<string, string>();
  const stub = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  // @ts-expect-error — test-only global
  globalThis.window = { sessionStorage: stub };
  return () => {
    // @ts-expect-error — test-only global cleanup
    delete globalThis.window;
  };
}

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: online },
    configurable: true,
    writable: true,
  });
}

const ONE_TAP_BODY: OneTapCodeBlueRequest = {
  idempotencyToken: "tok-one-tap-drill-1",
  managerUserId: "u-vet-1",
  managerUserName: "Dr. Vet",
  preCheckPassed: true,
  locationHint: { roomId: null },
};

const TELEMETRY_URL = "/api/realtime/telemetry";

describe("R-CBF-1.5 · one-tap endpoint is an offline-blocked emergency mutation", () => {
  it("classifies POST /api/code-blue/one-tap as an emergency `start` mutation", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/one-tap", "POST")).toBe("start");
  });

  it("does NOT classify the read-only active-session poll", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/active", "GET")).toBeNull();
  });
});

describe("R-CBF-1.5 · api.codeBlue.sessions.oneTap fails loud and is never queued", () => {
  let teardownStorage: (() => void) | undefined;

  beforeEach(async () => {
    addPendingSyncSpy.mockClear();
    authFetchMock.mockReset();
    toastErrorMock.mockClear();
    await offlineDb.pendingSync.clear();
    teardownStorage = installSessionStorageShim();
    _clearEmergencyBlockBufferForTests();
  });

  afterEach(() => {
    _clearEmergencyBlockBufferForTests();
    teardownStorage?.();
    teardownStorage = undefined;
  });

  it("truly offline: rejects loudly, records locally, never enqueues, never posts telemetry", async () => {
    setNavigatorOnline(false);
    // Every request attempt fails with a network TypeError; the telemetry POST
    // must NOT even be attempted while offline.
    authFetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { api } = await import("../src/lib/api");

    await expect(api.codeBlue.sessions.oneTap(ONE_TAP_BODY)).rejects.toMatchObject({
      name: "OfflineEmergencyMutationBlockedError",
      endpointClass: "start",
    });

    // Never queued for offline replay.
    expect(addPendingSyncSpy).not.toHaveBeenCalled();
    expect(await getAllPendingSync()).toEqual([]);

    // Loud, immediate failure (toast).
    expect(toastErrorMock).toHaveBeenCalled();

    // Recorded to the tab-local FIFO buffer as a `start` block.
    const buffer = _readEmergencyBlockBufferForTests();
    expect(buffer).toHaveLength(1);
    expect(buffer[0]?.endpointClass).toBe("start");
    expect(buffer[0]?.reason).toBe("offline");

    // Doctrine: while offline the block-telemetry is NOT posted (server
    // unreachable) and the sessionStorage buffer is never sent.
    const telemetryPosts = authFetchMock.mock.calls.filter(([url]) =>
      String(url).includes(TELEMETRY_URL),
    );
    expect(telemetryPosts).toHaveLength(0);
  });

  it("flaky network (navigator online): blocks, never enqueues, and emits the bounded `start` block telemetry", async () => {
    setNavigatorOnline(true);
    authFetchMock.mockImplementation((url: string) => {
      if (String(url).includes(TELEMETRY_URL)) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      // The one-tap mutation itself fails with a transient network error.
      return Promise.reject(new TypeError("Failed to fetch"));
    });

    const { api } = await import("../src/lib/api");

    await expect(api.codeBlue.sessions.oneTap(ONE_TAP_BODY)).rejects.toMatchObject({
      name: "OfflineEmergencyMutationBlockedError",
      endpointClass: "start",
    });

    // Still never enqueued.
    expect(addPendingSyncSpy).not.toHaveBeenCalled();
    expect(await getAllPendingSync()).toEqual([]);

    // The bounded-enum block telemetry POST was emitted — this is the wire
    // signal that increments `offline_emergency_mutation_blocked_start`.
    const telemetryCall = authFetchMock.mock.calls.find(([url]) =>
      String(url).includes(TELEMETRY_URL),
    );
    expect(telemetryCall, "expected a telemetry POST for the blocked mutation").toBeTruthy();
    const init = telemetryCall?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      offlineEmergencyMutationBlocked?: string;
    };
    expect(body.offlineEmergencyMutationBlocked).toBe("start");

    // The telemetry payload carries ONLY the bounded enum class — never the
    // sessionStorage buffer contents (no PII, no raw entries).
    expect(String(init?.body)).not.toContain("vt_offline_emergency_buffer");
  });
});
