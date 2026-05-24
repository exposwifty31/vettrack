/**
 * Phase 10 P1-10 regression: chunk-load recovery must guard
 * against reload loops using sessionStorage (matching index.html pattern).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { PageErrorBoundary } from "../src/components/ui/page-error-boundary";
import * as chunkRecovery from "../src/lib/chunk-load-recovery";

describe("P1-10: PageErrorBoundary reload loop guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("delegates chunk recovery to chunk-load-recovery module", async () => {
    const fs = await import("fs");
    const boundarySource = fs.readFileSync(
      "src/components/ui/page-error-boundary.tsx",
      "utf8",
    );
    const recoverySource = fs.readFileSync(
      "src/lib/chunk-load-recovery.ts",
      "utf8",
    );
    expect(boundarySource).toContain("recoverFromChunkLoadFailure");
    expect(boundarySource).not.toContain("removeItem(CHUNK_RECOVERY_GUARD_KEY)");
    expect(recoverySource).toContain("vt_chunk_recovery_guard");
    expect(recoverySource).toContain("sessionStorage");
    expect(recoverySource).toContain('k.startsWith("vettrack-")');
    expect(recoverySource).toContain("caches.delete");
  });

  it("does not leave Try Again as a no-op after a guarded reload fails", async () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    vi.spyOn(chunkRecovery, "recoverFromChunkLoadFailure").mockResolvedValue(false);

    const boundary = new PageErrorBoundary({ children: null });
    boundary.state = {
      hasError: true,
      errorMessage: "Importing a module script failed",
    };
    const setState = vi.fn((state: typeof boundary.state) => {
      boundary.state = state;
    });
    boundary.setState = setState as typeof boundary.setState;

    boundary.reset();
    await Promise.resolve();

    expect(chunkRecovery.recoverFromChunkLoadFailure).toHaveBeenCalled();
    expect(setState).toHaveBeenCalledWith({ hasError: false, errorMessage: "" });
    expect(reload).not.toHaveBeenCalled();
  });
});
