import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RECOVERY_GUARD_KEY,
  chunkLoadErrorFromReason,
  isChunkLoadError,
  recoverFromChunkLoadFailure,
} from "../src/lib/chunk-load-recovery";

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

describe("chunk-load-recovery", () => {
  it("detects Safari module import failures", () => {
    expect(isChunkLoadError("Importing a module script failed")).toBe(true);
  });

  it("detects Chrome dynamic import failures", () => {
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError("Network Error")).toBe(false);
  });

  it("extracts chunk errors from Error reasons", () => {
    const msg = chunkLoadErrorFromReason(
      new Error("Importing a module script failed"),
    );
    expect(msg).toBe("Importing a module script failed");
  });

  it("returns null for non-chunk string reasons", () => {
    expect(chunkLoadErrorFromReason("Network Error")).toBeNull();
  });
});

describe("recoverFromChunkLoadFailure (#413 deploy recovery)", () => {
  let sessionStorage: ReturnType<typeof createStorageMock>;
  let reload: ReturnType<typeof vi.fn>;
  let cacheDelete: ReturnType<typeof vi.fn>;
  let cacheKeys: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage = createStorageMock();
    reload = vi.fn();
    cacheDelete = vi.fn().mockResolvedValue(true);
    cacheKeys = vi.fn().mockResolvedValue(["vettrack-old", "other-cache"]);

    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("caches", {
      keys: cacheKeys,
      delete: cacheDelete,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears vettrack-* caches and reloads once per session", async () => {
    const scheduled = await recoverFromChunkLoadFailure();

    expect(scheduled).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RECOVERY_GUARD_KEY)).toBe("1");
    expect(cacheKeys).toHaveBeenCalledOnce();
    expect(cacheDelete).toHaveBeenCalledWith("vettrack-old");
    expect(cacheDelete).not.toHaveBeenCalledWith("other-cache");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload when session guard is already set", async () => {
    sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, "1");

    const scheduled = await recoverFromChunkLoadFailure();

    expect(scheduled).toBe(false);
    expect(cacheKeys).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("force: true bypasses the session guard for user-initiated retries", async () => {
    sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, "1");

    const scheduled = await recoverFromChunkLoadFailure({ force: true });

    expect(scheduled).toBe(true);
    expect(cacheKeys).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("unregisters service workers when requested", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistrations },
    });

    await recoverFromChunkLoadFailure({ unregisterServiceWorkers: true });

    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
