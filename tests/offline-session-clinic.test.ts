import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOfflineSession,
  restoreOfflineSession,
  saveOfflineSession,
} from "../src/lib/offline-session";

const SESSION_KEY = "vt_session";

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  };
}

function baseSessionInput() {
  const tokenExp = Date.now() + 60 * 60 * 1000;
  return {
    userId: "user-offline-1",
    email: "offline@test.local",
    name: "Offline User",
    role: "technician",
    status: "active" as const,
    token: "offline-token",
    tokenExp,
  };
}

describe("offline-session clinic snapshot", () => {
  let storage: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    storage = createStorageMock();
    vi.stubGlobal("window", {
      localStorage: storage,
      sessionStorage: storage,
      navigator: { onLine: true },
    });
  });

  afterEach(() => {
    clearOfflineSession();
    vi.unstubAllGlobals();
  });

  it("saveOfflineSession persists clinicId", () => {
    saveOfflineSession({
      ...baseSessionInput(),
      clinicId: "clinic-persist-1",
    });

    const raw = storage.getItem(SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { clinicId?: string };
    expect(parsed.clinicId).toBe("clinic-persist-1");
  });

  it("restoreOfflineSession returns clinicId", () => {
    saveOfflineSession({
      ...baseSessionInput(),
      clinicId: "clinic-restore-1",
    });

    const snapshot = restoreOfflineSession();
    expect(snapshot?.clinicId).toBe("clinic-restore-1");
  });

  it("clearOfflineSession removes persisted clinicId", () => {
    saveOfflineSession({
      ...baseSessionInput(),
      clinicId: "clinic-clear-1",
    });

    clearOfflineSession();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(restoreOfflineSession()).toBeNull();
  });
});
