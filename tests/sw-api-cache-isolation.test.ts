/**
 * Phase 10 P1-9 regression: The SW must NOT cache authenticated API
 * GET responses to prevent tenant/session data bleed on shared devices.
 */
import { describe, it, expect } from "vitest";

describe("P1-9: SW API cache isolation", () => {
  it("sw.js API GET handler does not write to Cache Storage", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("public/sw.js", "utf8");
    const apiSection = source.slice(
      source.indexOf("3. API GET requests"),
      source.indexOf("4. Everything else"),
    );
    expect(apiSection).not.toContain("cache.put");
    expect(apiSection).not.toContain("cache.match");
  });

  it("sw.js emergency bypass denylist is preserved", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("public/sw.js", "utf8");
    expect(source).toContain("/api/display/snapshot");
    expect(source).toContain("/api/code-blue/sessions/active");
    expect(source).toContain("/api/realtime/stream");
    expect(source).toContain("EMERGENCY_BYPASS_PATHS");
  });
});
