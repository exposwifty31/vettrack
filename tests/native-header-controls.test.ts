/**
 * TestFlight 1.1.0 device findings, round 2 — header control contracts.
 *
 * - Dark-mode quick toggle must flip between EXPLICIT light/dark keyed on the
 *   currently ACTIVE mode. The old mapping turned dark "off" by writing
 *   "system", which resolves straight back to dark on a dark OS ("falls back
 *   to system which is black").
 * - The phone search overlay must portal out of the header: the header's
 *   backdrop-filter creates a stacking context that painted the fixed overlay
 *   (typed query + results) behind z-indexed page content.
 * - The settings provider must re-query prefers-color-scheme on return to
 *   foreground — WKWebView can miss the change event fired while suspended.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("dark-mode quick toggle — explicit tri-state-safe semantics", () => {
  for (const file of [
    "src/native/NativeHeader.tsx",
    "src/components/layout/TopbarSettingsMenu.tsx",
  ]) {
    it(`${file} toggles light/dark from the active mode, never to "system"`, () => {
      const source = read(file);
      expect(source).toContain('update({ appearance: isDarkNow ? "light" : "dark" })');
      expect(source).not.toContain('"dark" ? "system" : "dark"');
      // The switch reflects what is rendered, not just the stored enum.
      expect(source).toContain("MiniSwitch on={isDarkNow}");
      expect(source).toContain("useIsDarkActive");
    });
  }
});

describe("phone search overlay — escapes the blurred header's stacking context", () => {
  it("portals the fixed overlay to document.body", () => {
    const source = read("src/components/search/EquipmentSearchButton.tsx");
    const portalIdx = source.indexOf("open && createPortal(");
    expect(portalIdx).toBeGreaterThan(-1);
    expect(source).toContain("document.body");
    expect(source).toContain('import { createPortal } from "react-dom"');
  });

  it("keeps the header's own panels outside the <header> element", () => {
    const source = read("src/native/NativeHeader.tsx");
    const headerClose = source.indexOf("</header>");
    const panels = source.indexOf("{openPanel && (");
    expect(headerClose).toBeGreaterThan(-1);
    expect(panels).toBeGreaterThan(headerClose);
  });
});

describe("settings provider — foreground re-query of the OS scheme", () => {
  it("re-applies system appearance on visibilitychange and pageshow", () => {
    const source = read("src/hooks/use-settings.tsx");
    expect(source).toContain('document.addEventListener("visibilitychange", reapply)');
    expect(source).toContain('window.addEventListener("pageshow", reapply)');
    expect(source).toContain('settings.appearance === "system"');
  });
});
