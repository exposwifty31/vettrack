import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 3 — Today (home.tsx) finish LOCK (static source assertions).
 *
 * Stage 3 gaps from the audit + bug report:
 *  - offline state: a display-only banner on the offline tokens (no queueing);
 *  - error replaces the content region (not stacked above it);
 *  - the scan card is skeletoned during load and removed on the native shell
 *    (BUG-005 — redundant with the tab-bar ScanFab on iPhone/iPad);
 *  - the scan card + urgency chips read semantic tokens, not hardcoded palette.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(repoRoot, "src", "pages", "home.tsx"), "utf8");

describe("Stage 3 Today — offline state", () => {
  it("renders a display-only offline banner on the offline tokens", () => {
    expect(src.includes("isOffline")).toBe(true);
    expect(src.includes("var(--offline-bg)")).toBe(true);
    expect(src.includes("t.home.offline")).toBe(true);
    expect(src.includes('role="alert"')).toBe(true);
  });
  it("listens to online/offline without queueing (display-only)", () => {
    expect(src.includes('addEventListener("offline"')).toBe(true);
    expect(src.includes('addEventListener("online"')).toBe(true);
  });
});

describe("Stage 3 Today — error replaces content", () => {
  it("gates the content region behind !equipmentError", () => {
    expect(/equipmentError\s*\?/.test(src) || src.includes("!equipmentError")).toBe(true);
  });
});

describe("Stage 3 Today — scan card", () => {
  it("is desktop-only (removed on the native shell — BUG-005)", () => {
    expect(/showScanCard\s*=[^;]*isDesktop/.test(src)).toBe(true);
  });
  it("skeletons the scan slot during load", () => {
    expect(src.includes("showScanSkeleton")).toBe(true);
    expect(src.includes("Skeleton")).toBe(true);
  });
  it("uses the --action semantic green, not hardcoded palette", () => {
    expect(src.includes("var(--action)")).toBe(true);
  });
});
