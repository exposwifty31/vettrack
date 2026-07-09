import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 3 — Today finish LOCK (static source assertions).
 *
 * Phase 3 (A2) split home.tsx into the ops/floor surfaces; the Stage-3 primitives
 * moved with the code. These guards follow them:
 *  - offline banner + online/offline listeners → HomeShell (shared plumbing);
 *  - error replaces the content region → the ops/floor surfaces (showError branch);
 *  - the scan card stays gated on the fab scan-affordance (BUG-005) — reused
 *    QuickScanCard, semantic brand token, not hardcoded palette.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

const homeShell = read("src", "features", "today", "surfaces", "HomeShell.tsx");
// Phase 8: FloorHomeSurface became a dispatcher; the floor CONTENT (and its
// error-branch invariant) moved into the per-archetype floor surfaces.
const techSurface = read("src", "features", "today", "surfaces", "TechHomeSurface.tsx");
const vetSurface = read("src", "features", "today", "surfaces", "VetHomeSurface.tsx");
const studentSurface = read("src", "features", "today", "surfaces", "StudentHomeSurface.tsx");
const opsSurface = read("src", "features", "today", "surfaces", "OpsHomeSurface.tsx");
const quickScan = read("src", "features", "today", "QuickScanCard.tsx");

describe("Stage 3 Today — offline state (HomeShell)", () => {
  it("renders a display-only offline banner on the offline tokens", () => {
    expect(homeShell.includes("isOffline")).toBe(true);
    expect(homeShell.includes("var(--offline-bg)")).toBe(true);
    expect(homeShell.includes("t.home.offline")).toBe(true);
    expect(homeShell.includes('role="alert"')).toBe(true);
  });
  it("listens to online/offline without queueing (display-only)", () => {
    expect(homeShell.includes('addEventListener("offline"')).toBe(true);
    expect(homeShell.includes('addEventListener("online"')).toBe(true);
  });
});

describe("Stage 3 Today — error replaces content", () => {
  it("every content surface gates the content region behind a fetch-error branch", () => {
    for (const surface of [techSurface, vetSurface, studentSurface, opsSurface]) {
      expect(/showError\s*\?/.test(surface)).toBe(true);
      expect(surface.includes("<ErrorCard")).toBe(true);
    }
  });
});

describe("Stage 3 Today — scan card (reused QuickScanCard)", () => {
  it("is gated on the fab scan-affordance — iPad only, removed on iPhone/web (BUG-005)", () => {
    expect(/affordance !== "fab"/.test(quickScan)).toBe(true);
  });
  it("uses a semantic brand token, not hardcoded palette", () => {
    expect(quickScan.includes("var(--brand)")).toBe(true);
  });
});
