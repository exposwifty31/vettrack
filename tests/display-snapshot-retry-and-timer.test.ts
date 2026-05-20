/**
 * Phase 10 P1-6 + P1-7 regression:
 * - Display snapshot query retries on error (not retry:false)
 * - Code Blue display clears startedAtRef when session is null
 */
import { describe, it, expect } from "vitest";

describe("P1-6: Display snapshot retry", () => {
  it("useDisplaySnapshot has retry: 2 (not false)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/hooks/useDisplaySnapshot.ts", "utf8");
    expect(source).toContain("retry: 2");
    expect(source).not.toContain("retry: false");
  });
});

describe("P1-7: Code Blue display timer cleanup", () => {
  it("clears startedAtRef when session is null", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/pages/code-blue-display.tsx", "utf8");
    expect(source).toContain("startedAtRef.current = null");
  });
});
