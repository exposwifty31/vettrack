/**
 * TestFlight 1.1.0 (21) regressions — signed-out native surface contracts.
 *
 * - The native shell must not draw app chrome (header / tab bar / sidebar)
 *   around /signin and /signup: a signed-out user gets dead navigation (every
 *   tab bounces through AuthGuard back to /signin). Invisible in dev-bypass,
 *   which never lands on /signin.
 * - Clerk paints its card from `variables`, which are static colors — the
 *   auth pages must select the dark palette when dark styling is active,
 *   otherwise dark-mode devices get a white card on a black page.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  clerkAppearance,
  clerkAppearanceNative,
  getClerkAppearance,
  getClerkAppearanceNative,
} from "../src/lib/clerk-appearance";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("NativeShell — auth routes render without app chrome", () => {
  const source = read("src/native/NativeShell.tsx");

  it("carves out /signin and /signup before any chrome renders", () => {
    const carveOutIdx = source.indexOf("AUTH_ROUTE_PATTERN.test(location)");
    const headerIdx = source.indexOf("<NativeHeader");
    const tabBarIdx = source.indexOf("<NativeTabBar");
    const sidebarIdx = source.indexOf("<NativeTabSidebar");
    expect(carveOutIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(carveOutIdx);
    expect(tabBarIdx).toBeGreaterThan(carveOutIdx);
    expect(sidebarIdx).toBeGreaterThan(carveOutIdx);
  });

  it("matches auth routes including sub-paths, and nothing else", () => {
    const pattern = /^\/(signin|signup)(\/|$)/;
    expect(pattern.test("/signin")).toBe(true);
    expect(pattern.test("/signin/factor-one")).toBe(true);
    expect(pattern.test("/signup")).toBe(true);
    expect(pattern.test("/home")).toBe(false);
    expect(pattern.test("/equipment")).toBe(false);
    expect(pattern.test("/signinx")).toBe(false);
  });
});

describe("Sign-in — every clerk-js form is behind OfflineAuthGate", () => {
  const source = read("src/pages/signin.tsx");

  // Locate a JSX opening tag `<Name` for the real element, skipping any `<Name>`
  // that appears inside a prose code comment (e.g. "Do NOT mount `<SignIn>`").
  // A mounted component's tag is followed by whitespace/`/` (attributes or
  // self-close), never immediately by `>` or another identifier char.
  const openTagIdx = (name: string) => {
    const match = new RegExp(`<${name}(?![A-Za-z0-9>])`).exec(source);
    return match ? match.index : -1;
  };
  const assertWrappedByGate = (idx: number) => {
    expect(idx).toBeGreaterThan(-1);
    expect(source.lastIndexOf("<OfflineAuthGate>", idx)).toBeGreaterThan(-1);
    expect(source.indexOf("</OfflineAuthGate>", idx)).toBeGreaterThan(idx);
  };

  // The phone-flow branch mounts <PhoneSignIn/>, which uses clerk-js (useSignIn)
  // and would otherwise fire Clerk's own "No Internet Connection" toast while
  // offline — the exact leak this PR closes for the regular <SignIn/> form. The
  // phone form must sit inside OfflineAuthGate too, or the offline hole reopens
  // through the always-available "use phone sign-in" button.
  it("wraps the phone sign-in flow in OfflineAuthGate", () => {
    assertWrappedByGate(openTagIdx("PhoneSignIn"));
  });

  it("wraps the regular <SignIn/> form in OfflineAuthGate", () => {
    assertWrappedByGate(openTagIdx("SignIn"));
  });
});

describe("Clerk appearance — dark palette selected when dark is active", () => {
  it("swaps variables for dark and keeps element classes", () => {
    const dark = getClerkAppearance(true);
    const light = getClerkAppearance(false);
    expect(dark.variables.colorBackground).not.toBe(light.variables.colorBackground);
    expect(light).toBe(clerkAppearance);
    expect(dark.elements).toEqual(clerkAppearance.elements);
  });

  it("native variant keeps social buttons hidden in both palettes", () => {
    const darkNative = getClerkAppearanceNative(true);
    expect(getClerkAppearanceNative(false)).toBe(clerkAppearanceNative);
    expect(darkNative.elements.socialButtonsRoot).toBe("hidden");
    expect(darkNative.variables.colorBackground).toBe(
      getClerkAppearance(true).variables.colorBackground
    );
  });

  it("both auth pages pass the reactive dark flag to Clerk", () => {
    for (const page of ["src/pages/signin.tsx", "src/pages/signup.tsx"]) {
      const source = read(page);
      expect(source).toContain("useIsDarkActive");
      expect(source).toContain(
        "isNative ? getClerkAppearanceNative(isDark) : getClerkAppearance(isDark)"
      );
    }
  });
});
