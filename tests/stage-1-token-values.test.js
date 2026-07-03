import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 1 — iOS token foundation LOCK (static source assertions).
 *
 * This is the "finish + lock" gate for the Stage 1 design system. It reads the
 * raw source of the three token files and asserts the canonical values from the
 * Stage 1 prototype (docs/design-handoff/stages-full/project/Stage 1 - Token
 * Style Guide.dc.html) are present, so silent drift is caught in CI.
 *
 * Runtime whitespace after a `:` is collapsed so multi-space alignment in the
 * source (e.g. `--sys-red:    255 59 48;`) doesn't make assertions brittle.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const cssRaw = fs.readFileSync(path.join(repoRoot, "src", "index.css"), "utf8");
// Collapse runs of spaces/tabs so `--x:    a b` matches `--x: a b` (single-space form we assert).
const css = cssRaw.replace(/[ \t]+/g, " ");
const tw = fs.readFileSync(path.join(repoRoot, "tailwind.config.ts"), "utf8");
const tokens = fs.readFileSync(
  path.join(repoRoot, "src", "core", "entities", "design-tokens.ts"),
  "utf8",
);

const has = (decl) => css.includes(decl);

describe("Stage 1 token foundation — canonical color values", () => {
  it("light :root canvas / brand / action / Apple sys primitives", () => {
    expect(has("--background: 240 24% 96%")).toBe(true); // #F2F2F7 grouped canvas
    expect(has("--primary: 243 75% 59%")).toBe(true); // #4f46e5 indigo brand
    expect(has("--brand: #4f46e5")).toBe(true);
    expect(has("--action: #2f6f5e")).toBe(true); // reserved scan/confirm green
    expect(has("--sys-red: 255 59 48")).toBe(true);
    expect(has("--sys-orange: 255 149 0")).toBe(true);
    expect(has("--sys-green: 52 199 89")).toBe(true);
    expect(has("--sys-blue: 0 122 255")).toBe(true);
    expect(has("--sys-gray: 142 142 147")).toBe(true);
  });

  it("dark canvas / surface / brand / action", () => {
    expect(has("--background: 0 0% 0%")).toBe(true); // true-black
    expect(has("--card: 240 2% 11%")).toBe(true); // #1C1C1E surface
    expect(has("--primary: 234 89% 74%")).toBe(true); // #818CF8
    expect(has("--action: #4ccdaa")).toBe(true); // dark teal
    expect(has("--sys-red: 255 69 58")).toBe(true); // dark sys variants
    expect(has("--sys-green: 48 209 88")).toBe(true);
  });

  it("hero ink reconciled to the design's indigo-950 (#1e1b4b)", () => {
    expect(has("--brand-ink: #1e1b4b")).toBe(true);
    expect(has("--brand-ink: #312e81")).toBe(false); // old indigo-900 drift removed
  });
});

describe("Stage 1 token foundation — radius ramp", () => {
  it("iOS radius scale 10/12/14/16/20/pill + design --radius-lg alias", () => {
    expect(has("--radius: 14px")).toBe(true);
    expect(has("--radius-sm: 10px")).toBe(true);
    expect(has("--radius-md: 12px")).toBe(true);
    expect(has("--radius-lg: 14px")).toBe(true); // design alias for base radius
    expect(has("--radius-xl: 16px")).toBe(true);
    expect(has("--radius-2xl: 20px")).toBe(true);
    expect(has("--radius-pill: 999px")).toBe(true);
  });
});

describe("Stage 1 token foundation — type ramp on a 17px root", () => {
  it("rem type scale + display / largetitle aliases", () => {
    // Type ramp is now Dynamic-Type-aware: each base rem value is wrapped in
    // calc(<value> * var(--type-scale, 1)). The canonical values are unchanged
    // (drift protection preserved) — only the scale-multiplier wrapper was added.
    expect(has("--text-2xs: calc(0.647rem *")).toBe(true);
    expect(has("--text-xs: calc(0.765rem *")).toBe(true);
    expect(has("--text-sm: calc(0.882rem *")).toBe(true);
    expect(has("--text-base: calc(1rem *")).toBe(true);
    expect(has("--text-lg: calc(1.176rem *")).toBe(true);
    expect(has("--text-xl: calc(1.294rem *")).toBe(true);
    expect(has("--text-2xl: calc(2rem *")).toBe(true);
    expect(has("--text-3xl: calc(2.353rem *")).toBe(true);
    expect(has("--display: var(--text-3xl)")).toBe(true);
    expect(has("--text-largetitle: var(--text-2xl)")).toBe(true);
    expect(has("font-size: 17px")).toBe(true); // html root
  });
});

describe("Stage 1 token foundation — elevation + spacing", () => {
  it("5-rung shadow ladder + floating", () => {
    for (const name of ["hero", "card", "panel", "modal", "overlay", "floating"]) {
      expect(has(`--shadow-${name}:`)).toBe(true);
    }
  });
  it("4px spacing scale endpoints + target-min", () => {
    expect(has("--space-1: 2px")).toBe(true);
    expect(has("--space-13: 96px")).toBe(true);
    expect(has("--target-min: 44px")).toBe(true);
  });
});

describe("Stage 1 token foundation — first-class status enum", () => {
  it("stale + unknown status hues and pill fills exist", () => {
    expect(has("--status-stale:")).toBe(true);
    expect(has("--status-unknown:")).toBe(true);
    expect(has("--status-stale-bg:")).toBe(true);
    expect(has("--status-stale-fg:")).toBe(true);
    expect(has("--status-unknown-bg:")).toBe(true);
    expect(has("--status-unknown-fg:")).toBe(true);
  });
  it("design canonical maintenance/sterilized pill-fill aliases exist", () => {
    expect(has("--status-maintenance-bg:")).toBe(true);
    expect(has("--status-maintenance-fg:")).toBe(true);
    expect(has("--status-sterilized-bg:")).toBe(true);
    expect(has("--status-sterilized-fg:")).toBe(true);
  });
});

describe("Stage 1 token foundation — added token families (§01/§05/§06/§07)", () => {
  it("surface ramp (resting/raised/hover/pressed)", () => {
    expect(has("--surface:")).toBe(true);
    expect(has("--surface-2:")).toBe(true);
    expect(has("--surface-hover: #f7f6f3")).toBe(true);
    expect(has("--surface-active: #efede8")).toBe(true);
  });
  it("translucent bar material + reduced-transparency guard", () => {
    expect(has("--hairline:")).toBe(true);
    expect(has("--bar-bg:")).toBe(true);
    expect(has("--bar-bg-opaque:")).toBe(true);
    expect(has("--bar-blur:")).toBe(true);
    expect(css.includes("prefers-reduced-transparency")).toBe(true);
  });
  it("motion aliases + standard easing curve", () => {
    expect(has("--dur-fast: 120ms")).toBe(true);
    expect(has("--dur-base: 200ms")).toBe(true);
    expect(has("--dur-slow: 320ms")).toBe(true);
    expect(has("--ease-standard: cubic-bezier(0.2, 0, 0, 1)")).toBe(true);
  });
  it("size-class responsive layout tokens", () => {
    expect(has("--inline-margin:")).toBe(true);
    expect(has("--content-gap:")).toBe(true);
    expect(has("--max-content:")).toBe(true);
  });
  it("on-ink / brand-foreground name aliases", () => {
    expect(has("--brand-foreground:")).toBe(true);
    expect(has("--on-ink-bar:")).toBe(true);
    expect(has("--ink-skeleton:")).toBe(true);
    expect(has("--ink-shimmer:")).toBe(true);
  });
});

describe("Stage 1 token foundation — tailwind + typed mirror wiring", () => {
  it("tailwind exposes the 6-state status scale", () => {
    expect(tw.includes('stale: "hsl(var(--status-stale))"')).toBe(true);
    expect(tw.includes('unknown: "hsl(var(--status-unknown))"')).toBe(true);
    expect(tw.includes('maintenance: "hsl(var(--status-maintenance))"')).toBe(true);
    expect(tw.includes('sterilized: "hsl(var(--status-sterilized))"')).toBe(true);
  });
  it("tailwind exposes the shadow ladder, radius ramp, and DM Mono numerals", () => {
    expect(tw.includes("hero: 'var(--shadow-hero)'")).toBe(true);
    expect(tw.includes("floating: 'var(--shadow-floating)'")).toBe(true);
    expect(tw.includes("pill: 'var(--radius-pill)'")).toBe(true);
    expect(tw.includes('"DM Mono"')).toBe(true);
  });
  it("StatusKind union includes stale + unknown", () => {
    expect(tokens.includes('| "stale"')).toBe(true);
    expect(tokens.includes('| "unknown"')).toBe(true);
  });
});
