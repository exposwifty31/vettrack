import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 4 — QR scanner (qr-scanner.tsx) token + BUG-004 LOCK.
 *
 * BUG-004: the close control must be an always-visible ≥44px touch target on
 * iPhone. It lives in the always-rendered header and must be h-11 w-11 (44px).
 *
 * Restyle: the result-sheet indicators must read the --status-* semantic
 * tokens instead of hardcoded emerald/amber/red palette, and the scanning
 * reticle must be the white camera reticle. The Phase-5 portal + overlay
 * markers (fixed inset-0 z-50, qr-scanner-overlay-root, killAllCameras, qrbox
 * 250, permission_denied, safe-area paddings, scan-line prefix) are guarded by
 * tests/phase-5-pr-5-0-1-qr-overlay-positioning.test.ts and must stay intact.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(repoRoot, "src", "components", "qr-scanner.tsx"), "utf8");

describe("Stage 4 scanner — BUG-004 reachable ≥44px close", () => {
  it("the close button is a 44px (h-11 w-11) target", () => {
    const btn = src.match(/data-testid="btn-scanner-cancel"/);
    expect(btn).not.toBeNull();
    // The close Button block carries h-11 w-11 (44px) rather than the old h-10 (40px).
    const block = src.slice(
      src.indexOf('className="h-11 w-11 text-white hover:bg-white/10"'),
    );
    expect(block.includes('data-testid="btn-scanner-cancel"')).toBe(true);
  });
  it("preserves the always-visible portal overlay markers (Phase-5 contract)", () => {
    expect(src.includes("qr-scanner-overlay-root")).toBe(true);
    expect(src.includes('data-testid="qr-scanner-overlay"')).toBe(true);
    expect(src.includes("killAllCameras")).toBe(true);
    expect(src.includes('"permission_denied"')).toBe(true);
  });
});

describe("Stage 4 scanner — status tokens, no hardcoded palette", () => {
  const banned = ["emerald-", "amber-", "red-50", "red-100", "red-200", "red-300", "red-400", "red-600", "red-700", "red-900", "green-500", "green-600", "zinc-", "indigo-"];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(src.includes(token)).toBe(false);
    });
  }
  it("result-sheet indicators read the --status-* tokens", () => {
    expect(src.includes("var(--status-ok-bg)")).toBe(true);
    expect(src.includes("var(--status-ok-fg)")).toBe(true);
    expect(src.includes("var(--status-issue-border)")).toBe(true);
    expect(src.includes("var(--status-stale-bg)")).toBe(true);
    expect(src.includes("hsl(var(--status-ok))")).toBe(true);
  });
  it("scanning reticle is the white camera reticle", () => {
    expect(src.includes("border-t-4 border-l-4 border-white")).toBe(true);
    expect(src.includes("qr-scan-line absolute left-0 right-0 h-0.5 bg-white/80")).toBe(true);
  });
});
