/**
 * Phase 10 P1-10 regression: PageErrorBoundary.reset() must guard
 * against reload loops using sessionStorage (matching index.html pattern).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { PageErrorBoundary } from "../src/components/ui/page-error-boundary";

describe("P1-10: PageErrorBoundary reload loop guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses sessionStorage guard before reload", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/components/ui/page-error-boundary.tsx", "utf8");
    expect(source).toContain("vt_peb_reload_guard");
    expect(source).toContain("sessionStorage");
    expect(source).not.toMatch(/window\.location\.reload\(\);\s*\n\s*return;\s*\n\s*\}/);
  });

  it("clears vettrack-* caches before reload", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/components/ui/page-error-boundary.tsx", "utf8");
    expect(source).toContain('k.startsWith("vettrack-")');
    expect(source).toContain("caches.delete");
  });

  it("does not leave Try Again as a no-op after a guarded reload fails", () => {
    const storage = new Map([["vt_peb_reload_guard", "1"]]);
    const reload = vi.fn();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { location: { reload } });

    const boundary = new PageErrorBoundary({ children: null });
    boundary.state = {
      hasError: true,
      errorMessage: "Failed to fetch dynamically imported module",
    };
    const setState = vi.fn((state: typeof boundary.state) => {
      boundary.state = state;
    });
    boundary.setState = setState as typeof boundary.setState;

    boundary.reset();

    expect(storage.has("vt_peb_reload_guard")).toBe(false);
    expect(setState).toHaveBeenCalledWith({ hasError: false, errorMessage: "" });
    expect(reload).not.toHaveBeenCalled();
  });
});
