/**
 * @vitest-environment happy-dom
 *
 * R-PDF-1.4 — Analytics panel + read-only PO recommendations.
 *
 * Asserts: redacted explainability DTO (source-row refs + counts, no PII);
 * rendering/refresh writes ZERO POs (a PO is created only after explicit
 * confirmation + authorization); calm empty state on a healthy clinic; and the
 * cross-cutting a11y bar (single top-level heading, keyboard-operable controls
 * with visible focus, status by text/icon not color alone, ≥3:1 non-text /
 * ≥4.5:1 text contrast in BOTH light and dark, correct he+en + RTL).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { t, setStoredLocale } from "@/lib/i18n";
import { ReadinessForecastPanel } from "@/features/analytics/ReadinessForecastPanel";
import type { ReadinessForecast } from "@/types/readiness-forecast";

afterEach(() => {
  setStoredLocale("he"); // reset default locale for other tests
  cleanup();
});

const FORECAST: ReadinessForecast = {
  clinicId: "clinic-a",
  generatedAtMs: 1_700_000_000_000,
  horizonHours: 24,
  warnings: [
    {
      keyId: "consumable:iv",
      kind: "consumable",
      ref: "iv-set",
      unit: "unit",
      required: 10,
      available: 6,
      shortfall: 4,
      sourceAppointmentIds: ["appt-1", "appt-2"],
      sourceAppointmentCount: 2,
      burnConsumedUnits: 168,
      onHand: 6,
      incomingUnits: 0,
      incomingPurchaseOrderIds: [],
    },
  ],
  recommendations: [{ itemId: "iv-set", unit: "unit", suggestedQuantity: 4, shortfallKeyId: "consumable:iv" }],
};

const HEALTHY: ReadinessForecast = {
  clinicId: "clinic-a",
  generatedAtMs: 1_700_000_000_000,
  horizonHours: 24,
  warnings: [],
  recommendations: [],
};

// --- WCAG contrast math (real sRGB token values; no fabricated numbers) -------
type Rgb = [number, number, number];
function hslToRgb(h: number, s: number, l: number): Rgb {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
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
  const m = raw.match(/rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)/);
  if (!m) throw new Error(`Unparseable rgb()/alpha token: "${raw}"`);
  return { rgb: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])], a: parseFloat(m[4]) };
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
const CSS_SOURCE = readFileSync(resolve(__dirname, "../src/index.css"), "utf-8");
function extractAll(varName: string): string[] {
  const re = new RegExp(`${varName}:\\s*([^;]+);`, "g");
  const values: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS_SOURCE)) !== null) values.push(m[1].trim());
  if (values.length < 2) throw new Error(`Expected light + dark for ${varName}, found ${values.length}`);
  return values;
}
function tokenPair(varName: string): { light: string; dark: string } {
  const [light, dark] = extractAll(varName);
  return { light, dark };
}

describe("R-PDF-1.4 · ReadinessForecastPanel — a11y + redaction + read-only POs", () => {
  it("exposes a SINGLE top-level heading (no duplicate h1) with semantic heading order", () => {
    render(<ReadinessForecastPanel data={FORECAST} />);
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0); // page owns the h1
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1); // one region heading
    // No heading level skips past h3 (shortfalls + recommendations are h3).
    expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });

  it("region heading labels the panel via aria-labelledby", () => {
    const { container } = render(<ReadinessForecastPanel data={FORECAST} />);
    const region = container.querySelector("section[aria-labelledby]");
    expect(region).not.toBeNull();
    const labelledBy = region!.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.tagName).toBe("H2");
  });

  it("renders the redacted explainability DTO (source-row refs + counts, no PII)", () => {
    const { container } = render(<ReadinessForecastPanel data={FORECAST} />);
    // Shortfall magnitude by TEXT (not color alone).
    expect(screen.getByText(t.readinessForecast.shortBadge(4, "unit"))).toBeTruthy();
    // Source counts + row references (ids only).
    expect(screen.getByText(t.readinessForecast.sourceLine(2))).toBeTruthy();
    expect(container.textContent).toContain("appt-1");
    // No PII leaks: nothing that looks like an email/name field.
    expect(container.textContent).not.toContain("@");
  });

  it("status is conveyed by text + icon, never color alone", () => {
    render(<ReadinessForecastPanel data={FORECAST} />);
    const warning = screen.getByTestId("readiness-warning-consumable:iv");
    // A decorative (aria-hidden) status icon...
    expect(warning.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    // ...plus a redundant text label.
    expect(within(warning).getByText(t.readinessForecast.shortBadge(4, "unit"))).toBeTruthy();
  });

  it("renders ZERO purchase orders on render or refresh", () => {
    const onCreatePurchaseOrder = vi.fn();
    const { rerender } = render(
      <ReadinessForecastPanel data={FORECAST} onCreatePurchaseOrder={onCreatePurchaseOrder} />,
    );
    expect(onCreatePurchaseOrder).not.toHaveBeenCalled();
    // Refresh (new data reference) must not create a PO either.
    rerender(<ReadinessForecastPanel data={{ ...FORECAST }} onCreatePurchaseOrder={onCreatePurchaseOrder} />);
    expect(onCreatePurchaseOrder).not.toHaveBeenCalled();
  });

  it("creates a PO recommendation callback ONLY after explicit confirmation", () => {
    const onCreatePurchaseOrder = vi.fn();
    render(<ReadinessForecastPanel data={FORECAST} onCreatePurchaseOrder={onCreatePurchaseOrder} />);

    const createBtn = screen.getByRole("button", { name: t.readinessForecast.createPo });
    expect(createBtn.tagName).toBe("BUTTON"); // keyboard-operable by nature
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
    expect(createBtn.getAttribute("tabindex")).not.toBe("-1"); // tab-reachable
    expect(createBtn.className).toContain("focus-visible"); // visible focus indicator

    fireEvent.click(createBtn);
    // Still zero — a confirmation step is required first.
    expect(onCreatePurchaseOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t.readinessForecast.confirmPo }));
    expect(onCreatePurchaseOrder).toHaveBeenCalledTimes(1);
    expect(onCreatePurchaseOrder).toHaveBeenCalledWith(FORECAST.recommendations[0]);
  });

  it("shows a calm empty state for a healthy clinic (no false alarms)", () => {
    render(<ReadinessForecastPanel data={HEALTHY} />);
    expect(screen.getByText(t.readinessForecast.allReadyBody)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.readinessForecast.createPo })).toBeNull();
  });

  it("renders correctly in he and en (localized heading), with RTL-safe dynamic content", () => {
    const { container, rerender } = render(<ReadinessForecastPanel data={FORECAST} />);
    // Default locale is he in the test env.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(t.readinessForecast.title);
    // Dynamic item reference is bidi-isolated for correct RTL rendering.
    expect(container.querySelector("bdi")).not.toBeNull();

    setStoredLocale("en");
    rerender(<ReadinessForecastPanel data={FORECAST} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(t.readinessForecast.title);
  });

  // --- Contrast: real token values, both themes -----------------------------
  const THEMES = ["light", "dark"] as const;
  const FAMILIES = ["status-issue", "status-ok"] as const; // shortfall + calm-state
  const CARD = tokenPair("--card");
  for (const theme of THEMES) {
    for (const family of FAMILIES) {
      const fgRgb = parseHex(tokenPair(`--${family}-fg`)[theme]);
      const { rgb: bgTint, a } = parseRgbAlpha(tokenPair(`--${family}-bg`)[theme]);
      const effectiveBg = compositeOver(bgTint, a, parseHslTriplet(CARD[theme]));
      const ratio = contrastRatio(fgRgb, effectiveBg);

      it(`${theme} / ${family}: non-text (icon) contrast clears 3:1`, () => {
        expect(ratio).toBeGreaterThanOrEqual(3);
      });
      it(`${theme} / ${family}: text contrast clears 4.5:1`, () => {
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
