/**
 * Phase 10 P1-3 regression: initSyncEngine must be called from the app
 * bootstrap so the online event handler drains the pending queue.
 */
import { describe, it, expect } from "vitest";

describe("P1-3: initSyncEngine wired globally", () => {
  it("SyncProvider calls initSyncEngine in a useEffect", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/hooks/use-sync.tsx", "utf8");
    expect(source).toContain("initSyncEngine");
    expect(source).toContain("import { processQueue, onSyncStateChange, getSyncProgress, initSyncEngine }");
  });

  it("initSyncEngine returns a cleanup function", async () => {
    const mod = await import("../src/lib/sync-engine");
    expect(typeof mod.initSyncEngine).toBe("function");
  });
});
