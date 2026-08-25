/**
 * Visual contract: /signin and /signup use Stage 1 Ivory clinic door chrome.
 * Web keeps a contained sheet; Capacitor phone/tablet use full-bleed top-aligned
 * app doors (no floating card). Titles and chips stay page-specific.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";
import {
  clerkAppearance,
  clerkAppearanceNative,
  getClerkAppearance,
} from "../src/lib/clerk-appearance";
import { RoleChips, type SignupRequestedRole } from "@/features/auth/components/RoleChips";
import { AuthDoorChrome } from "@/features/auth/components/AuthDoorChrome";
import { useState } from "react";
import { t } from "@/lib/i18n";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

vi.mock("@/hooks/useDirection", () => ({
  useDirection: () => "ltr",
}));

vi.mock("react-helmet-async", () => ({
  Helmet: () => null,
  HelmetProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@clerk/clerk-react", () => ({
  ClerkLoading: () => null,
  ClerkFailed: () => null,
  ClerkLoaded: ({ children }: { children: ReactNode }) => children,
  SignIn: () => <div data-testid="clerk-sign-in-stub" />,
  SignUp: () => <div data-testid="clerk-sign-up-stub" />,
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
  useSignIn: () => ({ isLoaded: true, signIn: null, setActive: null }),
  useSignUp: () => ({ isLoaded: true, signUp: null }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useIsDarkActive: () => false,
}));

// Mutable so one test can flip the pages into the Capacitor branch. Default
// false — every other test in this file asserts the web door.
const runtime = vi.hoisted(() => ({ isNative: false, isTablet: false }));

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => runtime.isNative,
  capacitorPlatform: () => (runtime.isNative ? "ios" : "web"),
}));

vi.mock("@/native/tablet/useIsNativeTablet", () => ({
  useIsNativeTablet: () => runtime.isTablet,
}));

describe("Clerk appearance — Ivory inset form (not a second card)", () => {
  it("hides Clerk header title/subtitle and flattens the card chrome", () => {
    expect(clerkAppearance.elements.header).toMatch(/hidden/);
    expect(clerkAppearance.elements.headerTitle).toMatch(/hidden/);
    expect(clerkAppearance.elements.headerSubtitle).toMatch(/hidden/);
    expect(clerkAppearance.elements.formHeaderTitle).toMatch(/hidden/);
    expect(clerkAppearance.elements.formHeaderSubtitle).toMatch(/hidden/);
    expect(clerkAppearance.elements.card).toMatch(/shadow-none/);
    expect(clerkAppearance.elements.card).toMatch(/border-0|border-none/);
    expect(clerkAppearance.elements.card).toMatch(/bg-transparent/);
  });

  it("flattens Clerk's OUTER cardBox and its grey footer band", () => {
    // Clerk 5 moved the border/shadow/background OUT of `card` into a new
    // `cardBox` wrapper, and made `footer` grey and a sibling of `card` inside
    // it (core-2 upgrade guide). Styling `card` alone therefore still paints a
    // floating white card with a grey band — the exact thing the full-bleed
    // native door removes at page level. `max-w-none` is load-bearing too:
    // Clerk caps `cardBox` at its own width, so without it the form renders
    // narrower than the social buttons above it (ragged column on iPad).
    const box = clerkAppearance.elements.cardBox;
    expect(box).toMatch(/shadow-none/);
    expect(box).toMatch(/border-0|border-none/);
    expect(box).toMatch(/bg-transparent/);
    expect(box).toMatch(/w-full/);
    expect(box).toMatch(/max-w-none/);
    expect(clerkAppearance.elements.footer).toMatch(/bg-transparent/);
    // The native variant spreads the shared elements — it must not regress.
    expect(clerkAppearanceNative.elements.cardBox).toBe(box);
  });

  it("insets the label row's inline-end so the final Hebrew glyph is not sheared", () => {
    // ORDER is the shell's job now (see the direction test below) — this is only
    // the clipping fix. The row's inline-end item sits flush against an
    // ancestor's clipping edge and Hebrew final forms carry ink past their
    // advance width. Verified on device that neither `overflow-visible` nor
    // `direction` clears it; only insetting that side does.
    const row = clerkAppearance.elements.formFieldLabelRow;
    expect(row).toMatch(/pe-\d/);
    // A blanket `p`/`px` would inset the label off the input's edge too.
    expect(row).not.toMatch(/\bp-\d|\bpx-\d|\bps-\d/);
    // Locale-scoped, or the English form gets a stray inset.
    for (const cls of row.split(/\s+/)) expect(cls).toMatch(/^rtl:/);
    expect(clerkAppearanceNative.elements.formFieldLabelRow).toBe(row);
  });

  it("keeps direction on the Clerk INPUTS, never on the form wrapper", () => {
    // `dir="ltr"` on the wrapper put the whole form in an LTR box, so every row
    // Clerk lays out with `justify-content` or a leading icon came out mirrored
    // in Hebrew — label/hint swapped ends, alert icon on the wrong side, the
    // continue arrow trailing the wrong way. One cause, many symptoms; patching
    // them one at a time through `appearance` is what this replaces.
    const shell = read("src/components/clerk-auth-form-shell.tsx");
    expect(shell).not.toMatch(/<div[^>]*\bdir="ltr"/);
    expect(shell).not.toMatch(/<div[^>]*\blang="en"/);
    // ...but every typed field still has to be LTR, including ones that only
    // mount on a later step, which is why the MutationObserver stays.
    expect(shell).toMatch(/querySelectorAll\("input"\)/);
    expect(shell).toMatch(/setAttribute\("dir", "ltr"\)/);
    expect(shell).toMatch(/MutationObserver/);
    // The keyboard half of the original fix must survive untouched.
    expect(shell).toMatch(/autocapitalize/);
    expect(shell).toMatch(/autocorrect/);
  });

  it("keeps the native social/divider hides and the flattened cardBox intact", () => {
    // Guardrails the auth-door briefs call out by name — a later appearance edit
    // must not quietly widen or drop them.
    expect(clerkAppearanceNative.options.socialButtonsPlacement).toBe("bottom");
    for (const key of [
      "socialButtonsRoot",
      "socialButtonsBlockButton",
      "socialButtonsProviderIcon",
      "dividerRow",
      "dividerText",
    ] as const) {
      expect(clerkAppearanceNative.elements[key]).toBe("hidden");
    }
    // Web keeps Clerk's own social buttons — it only styles them.
    expect(clerkAppearance.elements.socialButtonsRoot).toBeUndefined();
    expect(clerkAppearance.elements.socialButtonsBlockButton).not.toBe("hidden");
    expect(clerkAppearance.elements.cardBox).toMatch(/max-w-none/);
  });

  it("takes Clerk's collapsed password row out of the accessibility tree", () => {
    // Clerk hides that row with height:0/opacity:0 and removes it from the
    // keyboard and pointer, but not from AT — VoiceOver announced a password
    // field, and a show-password button, that nobody can see, ahead of the email
    // one. `visibility` is the only property that drops it (measured against
    // Chrome's AXTree: `overflow:hidden` changed nothing), and it MUST stay
    // scoped to the identifier step or the real password field goes with it.
    const row = clerkAppearance.elements.formFieldRow__password;
    expect(row).toMatch(/invisible/);
    expect(row).toMatch(/cl-signIn-start/);
    expect(clerkAppearanceNative.elements.formFieldRow__password).toBe(row);
  });

  it("lets the auth-door spinners stop under reduce-motion, like the rest of the app", () => {
    // `prefers-reduced-motion` is plumbed (measured: `animate-shimmer
    // motion-reduce:animate-none` resolves to animation-name:none), and
    // `skeleton.tsx` is the house convention. These five were the outliers.
    for (const page of [
      "src/pages/signin.tsx",
      "src/pages/signup.tsx",
      "src/components/native-social-buttons.tsx",
    ]) {
      const source = read(page);
      for (const spin of source.match(/className="[^"]*animate-spin[^"]*"/g) ?? []) {
        expect(spin).toMatch(/motion-reduce:animate-none/);
      }
    }
  });

  it("gives every control that sits on the page a boundary that clears 3:1", () => {
    // WCAG 1.4.11. Computed from the tokens, not matched as a string — a future
    // edit that lightens the value has to fail here, and a string assertion
    // would not notice. `--ivory-border` is deliberately NOT usable in this
    // position: it is tuned for `--ivory-surface` and lands at 1.36:1 on the page.
    const css = read("src/index.css");
    const rel = (hex: string) => {
      const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [rel(a), rel(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const toHex = (channels: string) =>
      channels
        .trim()
        .split(/\s+/)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("");

    // Pair each borderStrong with the --ivory-bg of its own theme block.
    const blocks = [...css.matchAll(/--ivory-borderStrong:\s*([\d\s]+);/g)].map((m) => {
      const before = css.slice(0, m.index);
      const bg = [...before.matchAll(/--ivory-bg:\s*([\d\s]+);/g)].pop();
      if (!bg) throw new Error("--ivory-borderStrong declared with no --ivory-bg above it");
      return { border: toHex(m[1]), bg: toHex(bg[1]) };
    });
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const { border, bg } of blocks) {
      expect(ratio(border, bg)).toBeGreaterThanOrEqual(3);
    }

    // The chips must actually use it, and Google's button must carry Google's
    // own stroke — both were on `ivory-border`, which fails in this position.
    expect(read("src/features/auth/components/RoleChips.tsx")).toMatch(/border-ivory-borderStrong/);
    const social = read("src/components/native-social-buttons.tsx");
    const googleStrokes = [...social.matchAll(/border-\[#([0-9A-Fa-f]{6})\]/g)].map((m) => m[1]);
    expect(googleStrokes.length).toBeGreaterThanOrEqual(2);
    for (const [i, stroke] of googleStrokes.entries()) {
      expect(ratio(stroke, i === 0 ? "F2F2F7" : "000000")).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps primary CTA on brand indigo with a 44px+ target and md radius", () => {
    const primary = clerkAppearance.elements.formButtonPrimary;
    expect(primary).toMatch(/bg-primary/);
    expect(primary).not.toMatch(/bg-action|vt-action|--action/);
    expect(primary).toMatch(/min-h-\[44px\]|h-11|h-12|min-h-11/);
    expect(primary).toMatch(/rounded-md/);
  });

  it("dark accessor still swaps concrete variables (not hsl(var(--…)))", () => {
    const dark = getClerkAppearance(true);
    expect(dark.variables.colorBackground).toMatch(/^hsl\(/);
    expect(dark.variables.colorBackground).not.toMatch(/var\(--/);
    expect(clerkAppearanceNative.elements.socialButtonsRoot).toBe("hidden");
  });
});

describe("AuthDoorChrome — three platform layouts", () => {
  afterEach(() => {
    cleanup();
    runtime.isNative = false;
    runtime.isTablet = false;
  });

  /**
   * The layout is derived from `isCapacitorNative()` + `useIsNativeTablet()`, so
   * the tests drive those — the component takes no variant prop. A prop that only
   * exists so tests can force a layout is production surface nobody ships.
   */
  function renderDoor(platform: "web" | "phone" | "tablet", title: string) {
    runtime.isNative = platform !== "web";
    runtime.isTablet = platform === "tablet";
    const { container } = render(
      <AuthDoorChrome title={title} subtitle={`${title} sub`}>
        <div>form</div>
      </AuthDoorChrome>,
    );
    const root = container.querySelector<HTMLElement>(`[data-auth-door-variant='${platform}']`);
    if (!root) throw new Error(`AuthDoorChrome did not resolve to the "${platform}" layout`);
    return { root, sheet: screen.getByTestId("auth-door-sheet") };
  }

  it("web: centered Ivory sheet with shadow-card (management console)", () => {
    const { root, sheet } = renderDoor("web", "Web Title");
    expect(root.className).toMatch(/min-h-\[100dvh\]/);
    expect(root.className).toMatch(/justify-center/);
    expect(sheet.className).toMatch(/max-w-sm/);
    expect(sheet.className).toMatch(/rounded-2xl/);
    expect(sheet.className).toMatch(/border-ivory-border/);
    expect(sheet.className).toMatch(/bg-ivory-surface/);
    expect(sheet.className).toMatch(/shadow-card/);
  });

  it("phone: full-bleed top-aligned — no floating card, no 100dvh centering", () => {
    const { root, sheet } = renderDoor("phone", "Phone Title");
    expect(root.className).toMatch(/min-h-full/);
    expect(root.className).toMatch(/bg-ivory-bg/);
    expect(root.className).not.toMatch(/justify-center/);
    expect(root.className).not.toMatch(/min-h-\[100dvh\]/);
    expect(sheet.className).not.toMatch(/rounded-2xl/);
    expect(sheet.className).not.toMatch(/shadow-card/);
    expect(sheet.className).not.toMatch(/border-ivory-border/);
    expect(screen.getByTestId("auth-door-title").textContent).toBe("Phone Title");
  });

  it("tablet: full-bleed wider measure — not a tiny centered phone card", () => {
    const { root, sheet } = renderDoor("tablet", "Tablet Title");
    expect(root.className).toMatch(/min-h-full/);
    expect(root.className).not.toMatch(/justify-center/);
    expect(sheet.className).toMatch(/max-w-lg/);
    expect(sheet.className).not.toMatch(/max-w-sm/);
    expect(sheet.className).not.toMatch(/shadow-card/);
    expect(sheet.className).not.toMatch(/rounded-2xl/);
  });
});

describe("Auth pages — Ivory door chrome (source contract)", () => {
  it("AuthDoorChrome encodes web sheet + native full-bleed doors", () => {
    const chrome = read("src/features/auth/components/AuthDoorChrome.tsx");
    expect(chrome).toMatch(/bg-ivory-bg/);
    expect(chrome).toMatch(/vt-page-title/);
    expect(chrome).toMatch(/auth-door-sheet/);
    expect(chrome).toMatch(/shadow-card/);
    expect(chrome).toMatch(/useIsNativeTablet/);
    expect(chrome).toMatch(/isCapacitorNative/);
    expect(chrome).toMatch(/variant === "web"/);
    expect(chrome).toMatch(/"phone"/);
    expect(chrome).toMatch(/"tablet"/);
  });

  for (const page of ["src/pages/signin.tsx", "src/pages/signup.tsx"]) {
    it(`${page} drops the primary/5 wash and mounts AuthDoorChrome`, () => {
      const source = read(page);
      expect(source).not.toMatch(/from-primary\/5/);
      expect(source).toMatch(/AuthDoorChrome/);
      expect(source).not.toMatch(/text-2xl font-bold/);
    });
  }

  it("Welcome back is sign-in only; sign-up uses createAccount", () => {
    const signin = read("src/pages/signin.tsx");
    const signup = read("src/pages/signup.tsx");
    expect(signin).toMatch(/title=\{t\.authPage\.welcomeBack\}/);
    expect(signin).toMatch(/subtitle=\{t\.authPage\.signInSubtitle\}/);
    expect(signin).not.toMatch(/t\.authPage\.createAccount/);
    expect(signup).toMatch(/title=\{t\.authPage\.createAccount\}/);
    expect(signup).toMatch(/subtitle=\{t\.authPage\.signUpSubtitle\}/);
    expect(signup).not.toMatch(/t\.authPage\.welcomeBack/);
  });

  it("phone sign-in is not a second generic bg-card shadow-sm card", () => {
    const source = read("src/components/phone-sign-in.tsx");
    expect(source).not.toMatch(/bg-card border border-border rounded-2xl p-6 shadow-sm/);
    expect(source).toMatch(/bg-transparent|bg-ivory-surface|shadow-none/);
  });

  it("native social uses designed Apple fill + Google outline", () => {
    const source = read("src/components/native-social-buttons.tsx");
    expect(source).toMatch(/bg-foreground|bg-ivory-text|bg-black/);
    // Google's half is the outlined one. The stroke used to be `ivory-border`;
    // it is now Google's own, per theme — the contrast test below is what pins
    // the values, so this only asserts the outline still exists.
    expect(source).toMatch(/border border-\[#[0-9A-Fa-f]{6}\]/);
    expect(source).toMatch(/dark:border-\[#[0-9A-Fa-f]{6}\]/);
    expect(source).toMatch(/min-h-\[44px\]/);
  });

  it("native social draws no `or` rule — Clerk's own divider already sits below", () => {
    // On native, `clerkAppearanceNative` hides Clerk's `dividerRow`, so the only
    // separator was this component's own. It read as a seam in the middle of a
    // full-bleed door; the buttons run straight into the email field instead.
    const source = read("src/components/native-social-buttons.tsx");
    expect(source).not.toMatch(/>or</);
    expect(source).not.toMatch(/h-px flex-1 bg-ivory-border/);
  });

  it("NativeShell auth routes own safe-area — AuthDoorChrome must not re-pad SAT", () => {
    const shell = read("src/native/NativeShell.tsx");
    const chrome = read("src/features/auth/components/AuthDoorChrome.tsx");
    expect(shell).toMatch(/AUTH_ROUTE_PATTERN/);
    expect(shell).toMatch(/safe-area-inset-top/);
    expect(chrome).not.toMatch(/safe-area-inset-top/);
    expect(chrome).not.toMatch(/env\(safe-area/);
  });
});

describe("RoleChips — 44px Ivory interactive rows", () => {
  afterEach(() => cleanup());

  function Harness() {
    const [role, setRole] = useState<SignupRequestedRole | null>(null);
    return <RoleChips selectedRole={role} onSelectRole={setRole} />;
  }

  it("interactive chips are at least 44px tall with ivory unselected chrome", () => {
    render(<Harness />);
    const chips = screen.getAllByRole("radio");
    for (const chip of chips) {
      expect(chip.className).toMatch(/min-h-\[44px\]/);
      expect(chip.className).toMatch(/border-ivory-border|bg-ivory-surface/);
    }
    const vetChip = screen.getByTestId("role-chip-vet");
    fireEvent.click(vetChip);
    expect(vetChip.className).toMatch(/bg-primary/);
  });
});

describe("Sign-in / Sign-up pages render the Ivory door (web default)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_stub_key");
  });

  afterEach(() => {
    cleanup();
    runtime.isNative = false;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The 24rem reserve keeps the centered web sheet from resizing under the user
  // while clerk-js mounts. The native door is top-aligned, so the same reserve is
  // just dead space below a shorter form. Asserted through a render, not a source
  // grep: the class sits on a `cn()` branch, and a grep cannot tell which branch
  // it landed on — which is the whole thing under test.
  for (const [page, importPath, stub] of [
    ["sign-in", "@/pages/signin", "clerk-sign-in-stub"],
    ["sign-up", "@/pages/signup", "clerk-sign-up-stub"],
  ] as const) {
    it(`${page}: the Clerk slot reserves 24rem on web and not on native`, async () => {
      const { hook } = memoryLocation({ path: `/${page.replace("-", "")}`, record: true });

      const { default: WebPage } = await import(importPath);
      render(
        <Router hook={hook}>
          <WebPage />
        </Router>,
      );
      const webSlot = screen.getByTestId(stub).parentElement;
      if (!webSlot) throw new Error(`${stub} has no wrapping Clerk slot`);
      expect(webSlot.className).toMatch(/min-h-\[24rem\]/);

      cleanup();
      vi.resetModules();
      runtime.isNative = true;

      const { default: NativePage } = await import(importPath);
      render(
        <Router hook={hook}>
          <NativePage />
        </Router>,
      );
      const nativeSlot = screen.getByTestId(stub).parentElement;
      if (!nativeSlot) throw new Error(`${stub} has no wrapping Clerk slot`);
      expect(nativeSlot.className).not.toMatch(/min-h-\[24rem\]/);
      // Still the same flex column — only the reserve is gone.
      expect(nativeSlot.className).toMatch(/flex-col/);
    });
  }

  it("sign-in mounts Welcome back only (no role chips, no create-account title)", async () => {
    const { default: SignInPage } = await import("@/pages/signin");
    const { hook } = memoryLocation({ path: "/signin", record: true });
    render(
      <Router hook={hook}>
        <SignInPage />
      </Router>,
    );
    const sheet = screen.getByTestId("auth-door-sheet");
    expect(sheet).toBeTruthy();
    // Default mock is web → contained sheet
    expect(sheet.className).toMatch(/bg-ivory-surface/);
    expect(sheet.className).toMatch(/border-ivory-border/);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByTestId("role-chip-vet")).toBeNull();
    expect(screen.queryByTestId("role-chip-technician")).toBeNull();

    const title = screen.getByTestId("auth-door-title");
    expect(title.textContent).toBe(t.authPage.welcomeBack);
    expect(screen.queryByText(t.authPage.createAccount)).toBeNull();
  });

  it("sign-up mounts Create account title (never Welcome back) with interactive role chips", async () => {
    const { default: SignUpPage } = await import("@/pages/signup");
    const { hook } = memoryLocation({ path: "/signup", record: true });
    render(
      <Router hook={hook}>
        <SignUpPage />
      </Router>,
    );
    expect(screen.getByTestId("auth-door-sheet")).toBeTruthy();

    const title = screen.getByTestId("auth-door-title");
    expect(title.textContent).toBe(t.authPage.createAccount);
    expect(screen.queryByText(t.authPage.welcomeBack)).toBeNull();

    const chips = screen.getAllByRole("radio");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.className).toMatch(/min-h-\[44px\]/);
    }
  });
});
