/**
 * @vitest-environment happy-dom
 *
 * T-23d (R-EQ-F2 · small-02) — <ReadinessBadge> composes the merged tier
 * helper (src/lib/equipment-readiness-tier.ts) over StatusBadge
 * (src/components/ui/status-badge.tsx:46). Status must be conveyed by
 * shape + glyph + text, never color alone (a11y).
 *
 * jsdom/happy-dom have no layout or paint engine, so contrast can't be read
 * off `getComputedStyle` pixels. Instead this file parses the REAL CSS custom
 * properties the component paints with straight out of src/index.css (the
 * same values StatusBadge's `KIND` map resolves — see status-badge.tsx:16-23)
 * and computes the WCAG relative-luminance contrast ratio from those actual
 * hex/rgb token values, for both the light (:root) and dark (.dark) themes.
 *
 * Two ratios are asserted per tier per theme:
 *  - glyph contrast  (>= 3:1)   — the tier glyph (an icon whose OUTER SHAPE
 *    also differs per tier: circle / triangle / octagon) is painted in the
 *    same `--status-*-fg` color as the text, directly on the badge's own
 *    tinted fill (`--status-*-bg` alpha-composited over `--card`). This is
 *    the WCAG 1.4.11 non-text/graphical-object check.
 *  - text contrast   (>= 4.5:1) — the rendered label color (`--status-*-fg`)
 *    against that same composited fill.
 *
 * No existing contrast helper was found in the repo (grepped for
 * "contrast"), so the WCAG luminance/ratio math is implemented locally here.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { t } from "@/lib/i18n";
import { ReadinessBadge } from "@/components/ui/readiness-badge";
import type { EquipmentStatus } from "@/types/equipment";
import type { ReadinessTier } from "@/lib/equipment-readiness-tier";

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// WCAG 2.x contrast math (relative luminance + contrast ratio), computed from
// real sRGB values — no fabricated numbers.
// ---------------------------------------------------------------------------
type Rgb = [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ];
}

function parseHslTriplet(raw: string): Rgb {
  const [h, s, l] = raw.trim().split(/\s+/).map(parseFloat);
  return hslToRgb(h, s, l);
}

function parseHex(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as Rgb;
}

function parseRgbAlpha(raw: string): { rgb: Rgb; a: number } {
  const m = raw.match(
    /rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)/,
  );
  if (!m) throw new Error(`Unparseable rgb()/alpha token: "${raw}"`);
  return {
    rgb: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
    a: parseFloat(m[4]),
  };
}

function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const [rl, gl, bl] = [r, g, b].map(lin);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Extract the real token values from the actual stylesheet — not hardcoded
// duplicates. `--status-maint-fg` etc. must NOT match the unrelated
// `--status-maintenance-fg: var(--status-maint-fg);` alias line, hence the
// trailing colon in every pattern.
// ---------------------------------------------------------------------------
const CSS_SOURCE = readFileSync(
  resolve(__dirname, "../src/index.css"),
  "utf-8",
);

function extractAll(varName: string): string[] {
  const re = new RegExp(`${varName}:\\s*([^;]+);`, "g");
  const values: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS_SOURCE)) !== null) {
    values.push(m[1].trim());
  }
  if (values.length < 2) {
    throw new Error(
      `Expected at least 2 declarations (light + dark) for ${varName}, found ${values.length}`,
    );
  }
  return values;
}

// First declaration in source order is :root (light default); second is
// .dark (dark default) — verified against src/index.css (light block starts
// at ":root {", dark block at ".dark {", both before any [data-color-theme]
// override block).
function tokenPair(varName: string): { light: string; dark: string } {
  const [light, dark] = extractAll(varName);
  return { light, dark };
}

const CARD = tokenPair("--card");

// StatusBadge kind → the short CSS token family it actually resolves
// (status-badge.tsx:16-23: "maintenance" kind reads --status-maint-*, not
// --status-maintenance-*).
const KIND_TOKEN_FAMILY: Record<"ok" | "maintenance" | "issue", string> = {
  ok: "status-ok",
  maintenance: "status-maint",
  issue: "status-issue",
};

// Readiness tier → StatusBadge kind this component must compose over (pinned
// contract under test, mirrors the tier helper's 3-bucket semantics).
const TIER_TO_KIND: Record<ReadinessTier, "ok" | "maintenance" | "issue"> = {
  ready: "ok",
  caution: "maintenance",
  not_ready: "issue",
};

const REPRESENTATIVE_STATUS: Record<ReadinessTier, EquipmentStatus> = {
  ready: "ok",
  caution: "maintenance",
  not_ready: "issue",
};

const THEMES = ["light", "dark"] as const;
const TIERS: ReadinessTier[] = ["ready", "caution", "not_ready"];

describe("ReadinessBadge — contrast (real token values, light + dark)", () => {
  for (const theme of THEMES) {
    for (const tier of TIERS) {
      const kind = TIER_TO_KIND[tier];
      const family = KIND_TOKEN_FAMILY[kind];

      const fgHex = tokenPair(`--${family}-fg`)[theme];
      const bgToken = tokenPair(`--${family}-bg`)[theme];
      const cardHsl = CARD[theme];

      const fgRgb = parseHex(fgHex);
      const cardRgb = parseHslTriplet(cardHsl);
      const { rgb: bgTintRgb, a: bgAlpha } = parseRgbAlpha(bgToken);
      const effectiveBg = compositeOver(bgTintRgb, bgAlpha, cardRgb);

      it(`${theme} theme / "${tier}" tier: glyph contrast (fg vs. composited fill) clears 3:1`, () => {
        const ratio = contrastRatio(fgRgb, effectiveBg);
        expect(ratio).toBeGreaterThanOrEqual(3);
      });

      it(`${theme} theme / "${tier}" tier: rendered-text contrast (fg vs. composited fill) clears 4.5:1`, () => {
        const ratio = contrastRatio(fgRgb, effectiveBg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("ReadinessBadge — status conveyed by shape + glyph + text, not color alone", () => {
  for (const tier of TIERS) {
    const status = REPRESENTATIVE_STATUS[tier];
    const kind = TIER_TO_KIND[tier];

    it(`renders a screen-reader-visible text label for "${status}" (tier "${tier}")`, () => {
      render(<ReadinessBadge status={status} />);
      const expectedLabel = t.status[kind];
      expect(expectedLabel).toBeTruthy();
      const el = screen.getByText(expectedLabel);
      expect(el.textContent).toBe(expectedLabel);
    });

    it(`renders a decorative (aria-hidden) glyph distinct per tier for "${status}"`, () => {
      const { container } = render(<ReadinessBadge status={status} />);
      const glyph = container.querySelector("svg");
      expect(glyph).not.toBeNull();
      expect(glyph?.getAttribute("aria-hidden")).toBe("true");
      // The glyph's outer shape must differ per tier (circle / triangle /
      // octagon) — asserted via a stable per-tier marker so status is never
      // conveyed by color alone even to tooling that can't rasterize SVGs.
      expect(glyph?.getAttribute("data-readiness-tier")).toBe(tier);
    });
  }

  it("renders three different glyph markers across the three tiers (no shared color-only signal)", () => {
    const markers = TIERS.map((tier) => {
      const { container } = render(
        <ReadinessBadge status={REPRESENTATIVE_STATUS[tier]} />,
      );
      const marker = container.querySelector("svg")?.getAttribute("data-readiness-tier");
      cleanup();
      return marker;
    });
    expect(new Set(markers).size).toBe(3);
  });
});
