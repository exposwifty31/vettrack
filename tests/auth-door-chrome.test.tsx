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

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  capacitorPlatform: () => "web",
}));

vi.mock("@/native/tablet/useIsNativeTablet", () => ({
  useIsNativeTablet: () => false,
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
  afterEach(() => cleanup());

  it("web: centered Ivory sheet with shadow-card (management console)", () => {
    const { container } = render(
      <AuthDoorChrome variant="web" title="Web Title" subtitle="Web sub">
        <div>form</div>
      </AuthDoorChrome>,
    );
    const root = container.querySelector("[data-auth-door-variant='web']");
    const sheet = screen.getByTestId("auth-door-sheet");
    expect(root).toBeTruthy();
    expect(root!.className).toMatch(/min-h-\[100dvh\]/);
    expect(root!.className).toMatch(/justify-center/);
    expect(sheet.className).toMatch(/max-w-sm/);
    expect(sheet.className).toMatch(/rounded-2xl/);
    expect(sheet.className).toMatch(/border-ivory-border/);
    expect(sheet.className).toMatch(/bg-ivory-surface/);
    expect(sheet.className).toMatch(/shadow-card/);
  });

  it("phone: full-bleed top-aligned — no floating card, no 100dvh centering", () => {
    const { container } = render(
      <AuthDoorChrome variant="phone" title="Phone Title" subtitle="Phone sub">
        <div>form</div>
      </AuthDoorChrome>,
    );
    const root = container.querySelector("[data-auth-door-variant='phone']");
    const sheet = screen.getByTestId("auth-door-sheet");
    expect(root).toBeTruthy();
    expect(root!.className).toMatch(/min-h-full/);
    expect(root!.className).toMatch(/bg-ivory-bg/);
    expect(root!.className).not.toMatch(/justify-center/);
    expect(root!.className).not.toMatch(/min-h-\[100dvh\]/);
    expect(sheet.className).not.toMatch(/rounded-2xl/);
    expect(sheet.className).not.toMatch(/shadow-card/);
    expect(sheet.className).not.toMatch(/border-ivory-border/);
    expect(screen.getByTestId("auth-door-title").textContent).toBe("Phone Title");
  });

  it("tablet: full-bleed wider measure — not a tiny centered phone card", () => {
    const { container } = render(
      <AuthDoorChrome variant="tablet" title="Tablet Title" subtitle="Tablet sub">
        <div>form</div>
      </AuthDoorChrome>,
    );
    const root = container.querySelector("[data-auth-door-variant='tablet']");
    const sheet = screen.getByTestId("auth-door-sheet");
    expect(root).toBeTruthy();
    expect(root!.className).toMatch(/min-h-full/);
    expect(root!.className).not.toMatch(/justify-center/);
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
    expect(source).toMatch(/border-ivory-border/);
    expect(source).toMatch(/min-h-\[44px\]/);
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
    fireEvent.click(chips[1]!);
    expect(chips[1]!.className).toMatch(/bg-primary/);
  });
});

describe("Sign-in / Sign-up pages render the Ivory door (web default)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_stub_key");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

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
