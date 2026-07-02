import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 2 — Button primitive token LOCK (static source assertions).
 *
 * Encodes the Stage 2 iOS Button contract (docs/design-handoff/stages-full/
 * project/Stage 2 - Component Library.dc.html §6): 14px radius, 700 weight,
 * a 56px `lg` control, a semantic `action` (scan/confirm green) variant, a
 * hero-ink ghost variant, and a width-preserving loading state.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(
  path.join(repoRoot, "src", "components", "ui", "button.tsx"),
  "utf8",
);

describe("Stage 2 Button — radius + weight", () => {
  it("uses the 14px radius (rounded-lg) and drops rounded-xl entirely", () => {
    expect(src.includes("rounded-lg")).toBe(true);
    expect(src.includes("rounded-xl")).toBe(false); // 16px drift removed
  });
  it("uses 700 weight, not 600", () => {
    expect(src.includes("font-bold")).toBe(true);
    expect(src.includes("font-semibold")).toBe(false);
  });
});

describe("Stage 2 Button — sizes", () => {
  it("default keeps a 44px touch target and lg grows to 56px", () => {
    expect(src.includes("h-11")).toBe(true); // 44px default
    expect(src.includes("h-14")).toBe(true); // 56px lg CTA
  });
});

describe("Stage 2 Button — semantic variants", () => {
  it("exposes a scan/confirm `action` variant bound to --action tokens", () => {
    expect(/action:\s*"[^"]*var\(--action\)/.test(src)).toBe(true);
    expect(src.includes("var(--action-foreground)")).toBe(true);
  });
  it("exposes a hero-ink ghost variant bound to --on-ink tokens", () => {
    expect(/ghostHero:\s*"[^"]*var\(--on-ink/.test(src)).toBe(true);
  });
});

describe("Stage 2 Button — loading state", () => {
  it("imports a spinner and swaps it in while preserving width", () => {
    expect(src.includes("Loader2")).toBe(true);
    expect(src.includes("animate-spin")).toBe(true);
    expect(src.includes("loading")).toBe(true);
    expect(src.includes("aria-busy")).toBe(true);
    // children stay in layout (visibility hidden) so the button never resizes
    expect(src.includes("invisible")).toBe(true);
  });
  it("gates the spin animation under reduced motion", () => {
    expect(src.includes("motion-reduce:animate-none")).toBe(true);
  });
});
