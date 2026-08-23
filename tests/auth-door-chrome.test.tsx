/**
 * Visual contract: /signin and /signup use the Stage 1 Ivory clinic door —
 * one canvas, one sheet, flattened Clerk card — not the stock purple wash +
 * floating Clerk card pattern.
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

describe("Auth pages — Ivory door chrome (source contract)", () => {
  it("AuthDoorChrome is the shared Ivory canvas + sheet", () => {
    const chrome = read("src/features/auth/components/AuthDoorChrome.tsx");
    expect(chrome).toMatch(/bg-ivory-bg/);
    expect(chrome).toMatch(/bg-ivory-surface/);
    expect(chrome).toMatch(/border-ivory-border/);
    expect(chrome).toMatch(/vt-page-title/);
    expect(chrome).toMatch(/shadow-card/);
    expect(chrome).toMatch(/auth-door-sheet/);
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

  it("native social uses designed Apple fill + Google outline on the sheet", () => {
    const source = read("src/components/native-social-buttons.tsx");
    expect(source).toMatch(/bg-foreground|bg-ivory-text|bg-black/);
    expect(source).toMatch(/border-ivory-border/);
    expect(source).toMatch(/min-h-\[44px\]/);
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

describe("Sign-in / Sign-up pages render the Ivory sheet", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_stub_key");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sign-in mounts one Ivory sheet with Welcome back only (no role chips, no create-account title)", async () => {
    const { default: SignInPage } = await import("@/pages/signin");
    const { hook } = memoryLocation({ path: "/signin", record: true });
    const { container } = render(
      <Router hook={hook}>
        <SignInPage />
      </Router>,
    );
    const sheet = container.querySelector("[data-testid='auth-door-sheet']");
    expect(sheet).toBeTruthy();
    expect(sheet!.className).toMatch(/bg-ivory-surface/);
    expect(sheet!.className).toMatch(/border-ivory-border/);
    expect(container.querySelector(".from-primary\\/5")).toBeNull();
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
    const { container } = render(
      <Router hook={hook}>
        <SignUpPage />
      </Router>,
    );
    const sheet = container.querySelector("[data-testid='auth-door-sheet']");
    expect(sheet).toBeTruthy();
    expect(sheet!.className).toMatch(/bg-ivory-surface/);

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
