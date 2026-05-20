/**
 * P2-9 regression: notifyIfWaiting must compare the waiting SW's build tag
 * against the current bundle's BUILD_TAG before surfacing the update banner.
 *
 * Before fix: notifyIfWaiting unconditionally dispatched sw-update-available
 * for any waiting SW, even when the waiting version matched the current build.
 * This caused stale/incorrect update banners on page load.
 */
import { describe, it, expect } from "vitest";

describe("P2-9: notifyIfWaiting build-tag comparison", () => {
  it("notifyIfWaiting extracts build tag from waiting SW scriptURL", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.tsx", "utf8");

    expect(source).toContain("reg.waiting.scriptURL");
    expect(source).toContain('.searchParams.get("v")');
  });

  it("notifyIfWaiting suppresses banner when waiting tag matches BUILD_TAG", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.tsx", "utf8");

    // The guard should compare waitingTag against BUILD_TAG
    expect(source).toContain("waitingTag && waitingTag === BUILD_TAG");
  });

  it("SW_UPDATED handler still has the same build-tag guard", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.tsx", "utf8");

    // Both paths should check against BUILD_TAG
    expect(source).toContain("swBuildTag && swBuildTag === BUILD_TAG");
  });

  it("notifyIfWaiting early-returns on missing waiting worker", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.tsx", "utf8");

    // The function should early-return if no waiting worker
    const fnStart = source.indexOf("function notifyIfWaiting");
    const fnBody = source.slice(fnStart, source.indexOf("}", fnStart + 200) + 1);
    expect(fnBody).toContain("if (!reg.waiting) return");
  });

  it("URL parse failure falls through to show banner (fail-open)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/main.tsx", "utf8");

    // A try/catch around URL parse ensures broken scriptURLs don't suppress
    // the banner entirely
    const fnStart = source.indexOf("function notifyIfWaiting");
    const fnEnd = source.indexOf("}", source.indexOf("dispatchEvent", fnStart) + 10);
    const fnBody = source.slice(fnStart, fnEnd);
    expect(fnBody).toContain("try {");
    expect(fnBody).toContain("catch");
  });

  it("build-tag comparison logic correctly suppresses same-version banners", () => {
    const BUILD_TAG = "abc123";

    // Simulates the notifyIfWaiting logic
    function shouldNotify(scriptURL: string): boolean {
      try {
        const waitingTag = new URL(scriptURL).searchParams.get("v");
        if (waitingTag && waitingTag === BUILD_TAG) return false;
      } catch {
        // fall through
      }
      return true;
    }

    // Same build tag → suppress
    expect(shouldNotify("https://example.com/sw.js?v=abc123")).toBe(false);

    // Different build tag → show banner
    expect(shouldNotify("https://example.com/sw.js?v=def456")).toBe(true);

    // No v param → show banner (cannot verify, fail-open)
    expect(shouldNotify("https://example.com/sw.js")).toBe(true);

    // Broken URL → show banner (fail-open)
    expect(shouldNotify("")).toBe(true);
  });
});
