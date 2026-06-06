/**
 * Regression tests for the mobile navigation menu.
 *
 * Bug: opening the mobile menu rendered only the "OPERATIONS" category title with
 * no items beneath it. Items used `opacity-0` + a `navItemFade` CSS animation as
 * fade-in. The reduced-motion media query in `src/index.css` stripped the
 * animation but left `opacity-0` in place, leaving every nav item permanently
 * invisible for users with `prefers-reduced-motion: reduce` (default on iOS when
 * "Reduce Motion" is enabled).
 *
 * Fix: when reduced motion is on, force `opacity: 1` for elements carrying the
 * `navItemFade` arbitrary class so they show up alongside the disabled animation.
 *
 * These tests pin the contract so the regression cannot return:
 *   1. The CSS reduced-motion block keeps both `animation: none` AND an opacity
 *      override for `navItemFade` matches.
 *   2. The mobile nav items use i18n keys (no Hebrew/English UI literals leak in).
 *   3. The i18n keys referenced by nav labels resolve in both locales, so a
 *      missing translation cannot silently drop items from the menu.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const indexCss = fs.readFileSync(
  path.join(repoRoot, "src", "index.css"),
  "utf8",
);
const layoutSrc = fs.readFileSync(
  path.join(repoRoot, "src", "components", "layout.tsx"),
  "utf8",
);
const heLocale = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "locales", "he.json"), "utf8"),
);
const enLocale = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "locales", "en.json"), "utf8"),
);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reduced-motion fallback keeps menu items visible
// ─────────────────────────────────────────────────────────────────────────────

describe("Mobile nav — reduced-motion fallback", () => {
  it("CSS still disables the navItemFade animation under reduced motion", () => {
    const reducedMotionBlock = extractReducedMotionBlock(indexCss);
    expect(reducedMotionBlock).toMatch(/animation:\s*none\s*!important/);
    expect(reducedMotionBlock).toContain('[class*="navItemFade_"]');
  });

  it("CSS forces opacity:1 on navItemFade elements when reduced motion is on", () => {
    // Without this, the unconditional `opacity-0` Tailwind class on each nav
    // <Link> leaves the item permanently invisible whenever the animation is
    // stripped — exactly the bug we are guarding against.
    const reducedMotionBlock = extractReducedMotionBlock(indexCss);
    expect(reducedMotionBlock).toMatch(
      /\[class\*="navItemFade_"\][^{]*\{[^}]*opacity:\s*1\s*!important/s,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Core nav items remain wired up and use i18n labels
// ─────────────────────────────────────────────────────────────────────────────

const CORE_NAV_HREFS = ["/", "/equipment", "/alerts", "/inventory"];

describe("Mobile nav — core items present", () => {
  for (const href of CORE_NAV_HREFS) {
    it(`registers a nav entry for ${href}`, () => {
      // Match `{ href: "/equipment", label: ... }` (or its multi-line shape).
      const pattern = new RegExp(
        `href:\\s*["']${escapeRegex(href)}["'][^}]*label:`,
        "s",
      );
      expect(layoutSrc).toMatch(pattern);
    });
  }

  it("operationMenuItems lists every core href", () => {
    const opsBlock = layoutSrc.match(
      /operationMenuItems\s*=\s*useMemo\(\s*\(\s*\)\s*=>[\s\S]*?\),/,
    );
    expect(opsBlock).toBeTruthy();
    for (const href of CORE_NAV_HREFS) {
      expect(opsBlock[0]).toContain(`"${href}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nav labels resolve in both locales — no silent drops on missing keys
// ─────────────────────────────────────────────────────────────────────────────

// Keys read off `lh` (= t.layoutHebrew) inside the navItems memo. If any of
// these is missing from a locale file, `lh.<key>` is `undefined`, the item
// renders with no visible label and (worse) any future i18n hardening that
// filters falsy labels would drop the item entirely.
const LH_KEYS_USED_IN_NAV = [
  "home",
  "inventory",
  "analytics",
  "dashboard",
  "printQr",
  "inventoryItems",
  "procurement",
  "admin",
  "adminShifts",
  "stability",
  "appTour",
  "whatsNew",
  "quickGuide",
  "auditLog",
  "opsDashboard",
  "settings",
  "reportIssue",
  "restockNavLockedToast",
  "navLockActiveAria",
  "offline",
  "syncing",
  "synced",
  "pendingTitle",
  "pendingShort",
  "failedTitle",
  "failedShort",
  "pendingTooltip",
  "quickSettings",
  "allSettings",
  "bottomMenu",
  "bottomHome",
  "bottomEquipment",
  "closeScannerAria",
  "bottomScan",
  "bottomScanClose",
  "bottomRecap",
];

describe("Mobile nav — i18n labels resolve in every locale", () => {
  for (const key of LH_KEYS_USED_IN_NAV) {
    it(`he.json has layoutHebrew.${key}`, () => {
      expect(heLocale.layoutHebrew?.[key]).toBeTypeOf("string");
      expect(heLocale.layoutHebrew[key].length).toBeGreaterThan(0);
    });

    it(`en.json has layoutHebrew.${key}`, () => {
      expect(enLocale.layoutHebrew?.[key]).toBeTypeOf("string");
      expect(enLocale.layoutHebrew[key].length).toBeGreaterThan(0);
    });
  }

  it("layout.tsx still routes core menu labels through i18n (no raw strings)", () => {
    // Sanity guard: make sure the home/equipment/alerts entries reference an
    // i18n token rather than a bare string — that's how the bug was masked
    // before localization landed.
    const homeEntry = layoutSrc.match(/href:\s*"\/"[\s\S]{0,200}?label:\s*([^,\n]+)/);
    expect(homeEntry?.[1]).toMatch(/^(lh|t)\./);
    const equipEntry = layoutSrc.match(/href:\s*"\/equipment"[\s\S]{0,200}?label:\s*([^,\n]+)/);
    expect(equipEntry?.[1]).toMatch(/^(lh|t)\./);
    const alertsEntry = layoutSrc.match(/href:\s*"\/alerts"[\s\S]{0,200}?label:\s*([^,\n]+)/);
    expect(alertsEntry?.[1]).toMatch(/^(lh|t)\./);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractReducedMotionBlock(css) {
  // Capture the first `@media (prefers-reduced-motion: reduce) { ... }` block,
  // matching nested braces by counting.
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let i = css.indexOf("{", start);
  const open = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error("Unterminated @media block in src/index.css");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
