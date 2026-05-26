/**
 * Phase 10 P0-1 regression: Code Blue mutations must never be queued
 * offline via localStorage or pendingSync. The vt_cb_queue mechanism is removed;
 * emergency paths fail loud (toast + bounded telemetry / local buffer).
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearEmergencyBlockBufferForTests,
  _readEmergencyBlockBufferForTests,
  classifyEmergencyEndpoint,
  recordEmergencyBlockLocally,
} from "../src/lib/offline-emergency-block";
import { OfflineEmergencyMutationBlockedError } from "../src/lib/offline-policy";
import {
  addPendingSync,
  getAllPendingSync,
  offlineDb,
  type PendingSyncCreateInput,
} from "../src/lib/offline-db";

const addPendingSyncSpy = vi.hoisted(() => vi.fn());
const authFetchMock = vi.hoisted(() => vi.fn());

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
  toast: { error: vi.fn(), success: vi.fn() },
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

function pendingSyncOp(
  endpoint: string,
  method: string,
): PendingSyncCreateInput {
  return {
    type: "scan",
    endpoint,
    method,
    body: "{}",
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: Date.now(),
  };
}

const EMERGENCY_CASES: Array<{
  label: string;
  url: string;
  method: string;
  endpointClass: "start" | "log" | "end" | "presence";
}> = [
  {
    label: "POST /sessions (start)",
    url: "/api/code-blue/sessions",
    method: "POST",
    endpointClass: "start",
  },
  {
    label: "POST /sessions/:id/logs (log)",
    url: "/api/code-blue/sessions/sess-1/logs",
    method: "POST",
    endpointClass: "log",
  },
  {
    label: "PATCH /sessions/:id/end (end)",
    url: "/api/code-blue/sessions/sess-1/end",
    method: "PATCH",
    endpointClass: "end",
  },
  {
    label: "PATCH /sessions/:id/presence (presence)",
    url: "/api/code-blue/sessions/sess-1/presence",
    method: "PATCH",
    endpointClass: "presence",
  },
];

describe("P0-1: Code Blue offline queue removed", () => {
  it("classifyEmergencyEndpoint blocks POST /sessions", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions", "POST")).toBe("start");
  });

  it("classifyEmergencyEndpoint blocks POST /sessions/:id/logs", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/logs", "POST")).toBe("log");
  });

  it("classifyEmergencyEndpoint blocks PATCH /sessions/:id/end", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/end", "PATCH")).toBe("end");
  });

  it("classifyEmergencyEndpoint blocks PATCH /sessions/:id/presence", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/presence", "PATCH")).toBe("presence");
  });

  it("classifyEmergencyEndpoint allows GET /sessions/active (read-only)", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/active", "GET")).toBeNull();
  });

  it("useCodeBlueSession.ts no longer contains vt_cb_queue references", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    expect(source).not.toContain("vt_cb_queue");
    expect(source).not.toContain("QUEUE_KEY");
    expect(source).not.toContain("loadQueue");
    expect(source).not.toContain("saveQueue");
    expect(source).not.toContain("_flushInProgress");
    expect(source).toContain("api.codeBlue.sessions");
    expect(source).toContain("OfflineEmergencyMutationBlockedError");
  });
});

describe("P0-1: Code Blue never enqueued in pendingSync", () => {
  let teardownStorage: (() => void) | undefined;

  beforeEach(async () => {
    addPendingSyncSpy.mockClear();
    authFetchMock.mockClear();
    await offlineDb.pendingSync.clear();
    teardownStorage = installSessionStorageShim();
    _clearEmergencyBlockBufferForTests();
    setNavigatorOnline(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
  });

  afterEach(() => {
    _clearEmergencyBlockBufferForTests();
    teardownStorage?.();
    teardownStorage = undefined;
    vi.unstubAllGlobals();
  });

  it.each(EMERGENCY_CASES)(
    "addPendingSync choke point rejects $label",
    async ({ url, method }) => {
      await expect(addPendingSync(pendingSyncOp(url, method))).rejects.toBeInstanceOf(
        OfflineEmergencyMutationBlockedError,
      );
      expect(addPendingSyncSpy).toHaveBeenCalledTimes(1);
      expect(await getAllPendingSync()).toEqual([]);
    },
  );

  it.each(EMERGENCY_CASES)(
    "api.request() rejects $label on network error without enqueueing",
    async ({ url, method, endpointClass }) => {
      const { request } = await import("../src/lib/api");

      await expect(
        request(url, { method, body: "{}" }, { offlineType: "scan", optimisticResult: {} }),
      ).rejects.toMatchObject({
        name: "OfflineEmergencyMutationBlockedError",
        endpointClass,
      });

      expect(addPendingSyncSpy).not.toHaveBeenCalled();
      expect(await getAllPendingSync()).toEqual([]);
    },
  );

  it("hook-layer log mutation uses api.request path (emergency block in request(), not authFetch)", () => {
    const source = readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    expect(source).toContain("api.codeBlue.sessions.appendLog");
    expect(source).not.toMatch(/authFetch\s*\(\s*[`'"]\/api\/code-blue\/sessions/);
  });

  it("hook-layer presence uses api.request path (emergency block in request(), not authFetch)", () => {
    const source = readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    expect(source).toContain("api.codeBlue.sessions.sendPresence");
    expect(source).not.toMatch(/authFetch\s*\(\s*[`'"]\/api\/code-blue\/sessions/);
  });
});
