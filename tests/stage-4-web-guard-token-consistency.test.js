import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 4 — WebOnlyGuard viewport guard LOCK (static source assertions).
 *
 * BUG-009: the Command Center board (and the other desktop-dense web-only
 * surfaces) rendered on iPhone/iPad where they overflow and mislead. The guard
 * must (a) keep the Capacitor-native redirect and (b) add a <1024px viewport
 * guard that renders a dark guard screen routing the operator to a
 * mobile-appropriate view. It must reuse the shared `useIsDesktop()` hook, not
 * invent a second matchMedia.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const guardSrc = fs.readFileSync(
  path.join(repoRoot, "src", "app", "platform", "guards", "WebOnlyGuard.tsx"),
  "utf8",
);
const routesSrc = fs.readFileSync(path.join(repoRoot, "src", "app", "routes.tsx"), "utf8");
const enJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "locales", "en.json"), "utf8"));
const heJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "locales", "he.json"), "utf8"));

describe("Stage 4 WebOnlyGuard — viewport guard (BUG-009)", () => {
  it("reuses the shared useIsDesktop hook (no bespoke matchMedia)", () => {
    expect(guardSrc.includes("useIsDesktop")).toBe(true);
    expect(guardSrc.includes("matchMedia")).toBe(false);
  });
  it("keeps the Capacitor-native redirect", () => {
    expect(guardSrc.includes("isCapacitorNative")).toBe(true);
    expect(/return <Redirect to=\{fallback\}/.test(guardSrc)).toBe(true);
  });
  it("renders a guard screen below the desktop breakpoint", () => {
    expect(/if \(!isDesktop\)/.test(guardSrc)).toBe(true);
    expect(guardSrc.includes('data-testid="web-only-guard-screen"')).toBe(true);
  });
  it("guard screen routes to the fallback route via a CTA", () => {
    expect(guardSrc.includes("navigate(fallback)")).toBe(true);
    expect(guardSrc.includes('data-testid="web-only-guard-cta"')).toBe(true);
  });
  it("uses the dark themed background token, not hardcoded palette", () => {
    expect(guardSrc.includes("bg-background")).toBe(true);
    expect(guardSrc.includes("bg-white")).toBe(false);
    expect(/bg-(zinc|slate|gray|neutral)-\d/.test(guardSrc)).toBe(false);
  });
  it("reads copy from the i18n accessor, not hardcoded strings", () => {
    expect(guardSrc.includes("t.webOnlyGuard.title")).toBe(true);
    expect(guardSrc.includes("t.webOnlyGuard.description")).toBe(true);
    expect(guardSrc.includes("t.webOnlyGuard.cta")).toBe(true);
  });
  it("the board route routes narrow viewports to /my-equipment", () => {
    expect(
      /path="\/equipment\/board"[^]*?WebOnlyGuard fallback="\/my-equipment"/.test(routesSrc),
    ).toBe(true);
  });
  it("webOnlyGuard i18n keys exist with en/he parity", () => {
    for (const key of ["title", "description", "cta"]) {
      expect(typeof enJson.webOnlyGuard?.[key]).toBe("string");
      expect(typeof heJson.webOnlyGuard?.[key]).toBe("string");
    }
  });
});
