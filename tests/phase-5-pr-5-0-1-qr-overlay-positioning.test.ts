/**
 * Phase 5 PR 5.0.1 — QR scanner overlay vertical-centering production hotfix.
 *
 * Static-analysis tests for the minimal isolated fix:
 *   - `src/components/qr-scanner.tsx` root overlay swaps `h-[100dvh]` for
 *     the new `qr-scanner-overlay-root` class.
 *   - `src/index.css` declares `.qr-scanner-overlay-root` with a layered
 *     `svh / dvh / lvh` cascade so the layout tracks the largest stable
 *     viewport on supporting engines.
 *
 * Behavioural regression bar (Phase 5 plan §15 PR 5.0.1):
 *   - `killAllCameras` still invoked on unmount.
 *   - `Html5Qrcode` still instantiated with `qrbox: { width: 250, height: 250 }`.
 *   - Permission-denied path still produces `phase === "permission_denied"`.
 *   - Scan-line animation keyframes (`src/index.css:403-413`) untouched.
 *
 * Freeze contract (Phase 5 plan §15 PR 5.0.1 / §17 forbidden #25, #32):
 *   - PR 5.0.1 is coupled to nothing in the clinical-invariant rollout.
 *   - No shared viewport hook outside `qr-scanner.tsx`.
 *   - No new exports from the scanner file.
 *   - The scan-line keyframes block remains the source of the scan-line motion.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scannerPath = path.join(__dirname, "..", "src", "components", "qr-scanner.tsx");
const cssPath = path.join(__dirname, "..", "src", "index.css");
const scannerSource = fs.readFileSync(scannerPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

describe("Phase 5 PR 5.0.1 — QR scanner overlay positioning fix", () => {
  describe("CSS — layered viewport-height fallback", () => {
    it("declares the `.qr-scanner-overlay-root` rule", () => {
      expect(cssSource).toMatch(/\.qr-scanner-overlay-root\s*\{/);
    });

    it("layers 100vh / 100dvh / 100svh in cascade order (PR 5.4 refinement)", () => {
      const match = cssSource.match(/\.qr-scanner-overlay-root\s*\{([^}]*)\}/);
      expect(match).not.toBeNull();
      const body = match![1];
      // PR 5.4 refinement: `100svh` (smallest stable viewport) is the
      // LAST supported value, so on engines that support it the overlay
      // always fits within the always-visible area — the footer
      // (containing the manual-entry button) stays on-screen and the
      // frame centers within the actually-visible viewport. Older
      // engines degrade `dvh → vh`.
      //
      // The earlier PR 5.0.1 cascade ended at `100lvh` (largest stable
      // viewport), which pushed the footer below the visible area when
      // the URL bar was showing — that regression is what this PR fixes.
      const heights = [...body.matchAll(/height:\s*(100vh|100svh|100dvh|100lvh)\s*;/g)].map(
        (m) => m[1],
      );
      expect(heights).toEqual(["100vh", "100dvh", "100svh"]);
      // Defence-in-depth: the `100lvh` declaration must NOT be present —
      // its inclusion is precisely what caused the footer-clipping
      // regression PR 5.4 addresses.
      expect(heights).not.toContain("100lvh");
    });
  });

  describe("Scanner markup — uses the new class on the root overlay", () => {
    it("root overlay carries `qr-scanner-overlay-root`", () => {
      // The root overlay is identified by data-testid="qr-scanner-overlay".
      const rootMatch = scannerSource.match(
        /<div\s+className=("[^"]*"|`[^`]*`)\s+data-testid="qr-scanner-overlay"/,
      );
      expect(rootMatch).not.toBeNull();
      const cls = rootMatch![1];
      expect(cls).toContain("qr-scanner-overlay-root");
    });

    it("root overlay no longer hard-codes `h-[100dvh]`", () => {
      // The hot-fix replaces the Tailwind arbitrary `h-[100dvh]` with the
      // layered class. If a future PR reintroduces a single dvh anchor we
      // want to catch the regression.
      const rootMatch = scannerSource.match(
        /<div\s+className=("[^"]*"|`[^`]*`)\s+data-testid="qr-scanner-overlay"/,
      );
      expect(rootMatch).not.toBeNull();
      expect(rootMatch![1]).not.toContain("h-[100dvh]");
    });

    it("root overlay preserves `fixed top-0 left-0 right-0` anchoring + `flex flex-col`", () => {
      const rootMatch = scannerSource.match(
        /<div\s+className=("[^"]*"|`[^`]*`)\s+data-testid="qr-scanner-overlay"/,
      );
      expect(rootMatch).not.toBeNull();
      const cls = rootMatch![1];
      for (const token of ["fixed", "top-0", "left-0", "right-0", "z-[70]", "flex", "flex-col"]) {
        expect(cls).toContain(token);
      }
    });
  });

  describe("Behavioural regression bar — locked surfaces unchanged", () => {
    it("scan-line keyframes block is intact (animation shape may evolve)", () => {
      // The keyframes name + the 248px sweep distance + the existence of a
      // `.qr-scan-line` animation rule are the locked surface here. The
      // duration / timing-function / fill-mode may evolve across phases
      // (PR 6.1 pre-flight switched from `1.8s ease-in-out` ping-pong to
      // `1.4s linear infinite alternate` to eliminate endpoint dwell on
      // mobile Safari). See tests/qr-scan-line-animation.test.ts for the
      // current canonical shape.
      expect(cssSource).toMatch(/@keyframes\s+qr-scan-line\s*\{/);
      expect(cssSource).toContain("translate3d(0, 248px, 0)");
      expect(cssSource).toMatch(/\.qr-scan-line\s*\{[\s\S]*?animation:\s*qr-scan-line\s+/);
    });

    it("scan-line element still rendered inside the 250×250 frame", () => {
      expect(scannerSource).toContain('className="qr-scan-line absolute left-0 right-0 h-0.5');
    });

    it("`killAllCameras` is still called from the scanner lifecycle", () => {
      expect(scannerSource).toContain("killAllCameras");
    });

    it("`Html5Qrcode` is still instantiated with qrbox 250×250", () => {
      expect(scannerSource).toMatch(/qrbox:\s*\{\s*width:\s*250,\s*height:\s*250\s*\}/);
    });

    it("permission-denied phase is preserved", () => {
      expect(scannerSource).toContain('"permission_denied"');
    });

    it("safe-area-inset-top / -bottom paddings on header + footer untouched", () => {
      expect(scannerSource).toContain('"max(1rem, env(safe-area-inset-top))"');
      expect(scannerSource).toContain('"max(1.5rem, env(safe-area-inset-bottom))"');
    });
  });

  describe("Freeze contract — PR 5.0.1 is isolated from clinical-invariant rollout", () => {
    it("scanner file does not import any clinical-invariant module", () => {
      // §17 forbidden #25 — no coupling between the QR hotfix and Phase 5
      // clinical-invariant code.
      expect(scannerSource).not.toMatch(/clinical[-_]invariant/i);
      expect(scannerSource).not.toMatch(/from\s+["']@\/.*authority\/enforcement/);
    });

    it("scanner file does not export any viewport / dvh / svh / lvh helper", () => {
      // §17 forbidden #32 — no shared viewport hook, cross-component
      // viewport utility, or viewport-related export from this file. Any
      // future `visualViewport` listener (permitted only as a fallback
      // per the binding fix-vector order) must remain file-local.
      //
      // Pre-existing exports (`extractEquipmentId`, `QrScanner`) predate
      // PR 5.0.1 and are explicitly out of scope for this constraint.
      const exportLines = scannerSource.split(/\r?\n/).filter((l) => /^export\s+/.test(l));
      const forbidden = /viewport|use[A-Z][a-zA-Z]*Viewport|[Vv]isualViewport|[Dd]vh|[Ss]vh|[Ll]vh|scannerVh|scanner_vh/;
      for (const line of exportLines) {
        expect(line).not.toMatch(forbidden);
      }
    });
  });
});
