/**
 * Regression: Hebrew on-shift elapsed days must not leak the English compact
 * unit suffix `d`. Minutes already use `ד׳` elsewhere — day unit is `י׳`.
 */

import { describe, it, expect } from "vitest";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { t } from "../src/lib/i18n";
import { interpolate } from "../lib/i18n/index";

describe("homePage.elapsedDays — compact day unit by locale", () => {
  it("English keeps the compact {count}d form", () => {
    expect(enDict.homePage.elapsedDays).toBe("{count}d");
    expect(interpolate(enDict.homePage.elapsedDays, { count: 2 })).toBe("2d");
  });

  it("Hebrew uses geresh day abbreviation י׳, not English d or minutes ד׳", () => {
    expect(heDict.homePage.elapsedDays).toBe("{count} י׳");
    expect(heDict.homePage.elapsedDays).not.toMatch(/\{count\}d/);
    expect(heDict.homePage.elapsedDays).not.toContain("ד׳");
    expect(interpolate(heDict.homePage.elapsedDays, { count: 2 })).toBe("2 י׳");
  });

  it("typed t.homePage.elapsedDays interpolates the Hebrew default", () => {
    // Default locale is Hebrew; pins the hand-built accessor, not only the JSON.
    expect(t.homePage.elapsedDays(2)).toBe("2 י׳");
    expect(t.homePage.elapsedDays(2)).not.toBe("2d");
  });
});
