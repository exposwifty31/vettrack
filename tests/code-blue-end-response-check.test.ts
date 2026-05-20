/**
 * Phase 10 P0-2 regression: handleEndSession must check res.ok before
 * navigating to /home. On failure it must surface an error toast and
 * NOT navigate away.
 */
import { describe, it, expect } from "vitest";

describe("P0-2: Code Blue end session response gate", () => {
  it("code-blue.tsx handleEndSession checks res.ok before navigate", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/pages/code-blue.tsx", "utf8");
    expect(source).toContain("res.ok");
    expect(source).toContain("toast.error");
    expect(source).toContain("cb-end-failed");
    const navIdx = source.indexOf('navigate("/home")');
    const okIdx = source.indexOf("res.ok");
    expect(navIdx).toBeGreaterThan(0);
    expect(okIdx).toBeGreaterThan(0);
    expect(okIdx).toBeLessThan(navIdx);
  });
});
