/**
 * Phase 10 P1-9 regression: The SW must NOT cache authenticated API
 * GET responses to prevent tenant/session data bleed on shared devices.
 */
import { describe, it, expect } from "vitest";
import { EMERGENCY_CACHE_BYPASS_PATHS } from "../shared/emergency-surfaces.manifest";

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

  /**
   * The API handler being network-only is not sufficient on its own: the
   * navigation branch runs FIRST and writes any successful response under `/`
   * and `/index.html`. A `navigate`-mode request to an API path therefore
   * reached the shell cache without ever passing the API handler — and that
   * includes every emergency path in the denylist, whose bypass CLAUDE.md calls
   * unconditional. The guard belongs on the navigation branch, not on a
   * per-endpoint list, because adding one path leaves the class open.
   */
  it("sw.js navigation handler refuses API URLs, so no API response is cached as the shell", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("public/sw.js", "utf8");

    const navSection = source.slice(
      source.indexOf("1. Navigation requests"),
      source.indexOf("2a. Content-hashed build assets"),
    );
    expect(navSection).toContain('cache.put("/index.html"');
    // The branch must exclude API URLs before it can cache anything.
    expect(navSection).toMatch(/mode === "navigate"[\s\S]{0,80}!isApiRequest\(url\)/);
  });

  it("sw.js emergency bypass denylist is preserved", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("public/sw.js", "utf8");
    for (const path of EMERGENCY_CACHE_BYPASS_PATHS) {
      expect(source).toContain(path);
    }
    expect(source).toContain("EMERGENCY_BYPASS_PATHS");
  });

  it("sw.js serves /assets/* with network-first to prevent post-deploy chunk skew (#413)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("public/sw.js", "utf8");
  const hashedSection = source.slice(
    source.indexOf("2a. Content-hashed build assets"),
    source.indexOf("2b. Other static assets"),
  );
    expect(source).toContain("function isHashedBuildAsset(url)");
    expect(hashedSection).toContain("Strategy: network-first");
    expect(hashedSection).toContain("isHashedBuildAsset(url)");
    expect(hashedSection).toContain("await fetch(event.request)");
    expect(hashedSection.indexOf("await fetch")).toBeLessThan(
      hashedSection.indexOf("cache.match"),
    );
  });
});
