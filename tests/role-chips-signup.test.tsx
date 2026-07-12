/**
 * @vitest-environment happy-dom
 *
 * T24 (audit MEDIUM, design-touched) — the sign-in/up role chips
 * (`RoleChips.tsx`) used to be purely informational: three fixed `<span>`s
 * with no click handler and no state, on both the sign-in and sign-up pages.
 * The owner wants role-preselect signup: chips → role-tagged signup → admin
 * approval → land on the role app. This test pins the sanctioned first slice
 * — chips pre-select a role and that role is carried into the Clerk sign-up
 * submission via `unsafeMetadata` (Clerk's own mechanism for attaching
 * arbitrary data to a new account) — reusing the existing Clerk `<SignUp/>`
 * flow, no parallel form.
 *
 * Non-vacuous: against the old inert `RoleChips`, chips render as plain
 * `<span>`s with no `button`/`radio` role and no click handler, so the
 * "select a chip" step below could not occur, and the old `signup.tsx` never
 * passed `unsafeMetadata` to `<SignUp/>` at all — the assertion on
 * `capturedSignUpProps` would fail (prop absent) rather than passing
 * vacuously.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { RoleChips, type SignupRequestedRole } from "@/features/auth/components/RoleChips";

// Controlled via `mockDirection` per-test so the roving-focus keyboard tests
// below can assert RTL-aware Arrow-key handling deterministically, without
// depending on the ambient locale/localStorage state.
let mockDirection: "ltr" | "rtl" = "ltr";
vi.mock("@/hooks/useDirection", () => ({
  useDirection: () => mockDirection,
}));

const capturedSignUpProps: Array<Record<string, unknown>> = [];

// Helmet's title/meta management is irrelevant to the T24 role-wiring
// assertion below and its class-based context plumbing is unrelated
// churn to fight in a test environment — stub it out.
vi.mock("react-helmet-async", () => ({
  Helmet: () => null,
  HelmetProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@clerk/clerk-react", () => ({
  ClerkLoading: () => null,
  ClerkFailed: () => null,
  ClerkLoaded: ({ children }: { children: ReactNode }) => children,
  SignUp: (props: Record<string, unknown>) => {
    capturedSignUpProps.push(props);
    return <div data-testid="clerk-sign-up-stub" />;
  },
  SignIn: () => null,
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
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

vi.mock("@/lib/clerk-appearance", () => ({
  getClerkAppearance: () => ({}),
  getClerkAppearanceNative: () => ({}),
}));

function RoleChipsHarness() {
  const [role, setRole] = useState<SignupRequestedRole | null>(null);
  return <RoleChips selectedRole={role} onSelectRole={setRole} />;
}

function NonInteractiveRoleChipsHarness() {
  return <RoleChips />;
}

async function renderSignUpPage() {
  const { default: SignUpPage } = await import("@/pages/signup");
  const { hook } = memoryLocation({ path: "/signup", record: true });
  return render(
    <Router hook={hook}>
      <SignUpPage />
    </Router>,
  );
}

beforeEach(() => {
  capturedSignUpProps.length = 0;
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_stub_key");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("RoleChips — sign-up role pre-selection (T24)", () => {
  it("renders chips as a selectable radiogroup, not inert spans", () => {
    render(<RoleChipsHarness />);
    const group = screen.getByRole("radiogroup");
    const chips = within(group).getAllByRole("radio");
    expect(chips).toHaveLength(3);
    expect(chips.every((chip) => chip.tagName === "BUTTON")).toBe(true);
  });

  it("selecting a chip pre-selects that role (single-select, aria-checked reflects choice)", () => {
    render(<RoleChipsHarness />);
    const vetChip = screen.getByTestId("role-chip-vet");
    const studentChip = screen.getByTestId("role-chip-student");

    expect(vetChip.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");
    expect(studentChip.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(studentChip);
    expect(studentChip.getAttribute("aria-checked")).toBe("true");
    expect(vetChip.getAttribute("aria-checked")).toBe("false");
  });

  it("does not render as a selectable control when mounted without a selection handler (sign-in usage)", () => {
    render(<NonInteractiveRoleChipsHarness />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(t.authPage.roleVeterinarian).tagName).toBe("SPAN");
  });

  it("carries the selected role into the sign-up submission (Clerk unsafeMetadata), replacing the inert chips", async () => {
    await renderSignUpPage();

    // Before any selection: no requested role is attached to the sign-up call.
    const initialProps = capturedSignUpProps.at(-1);
    expect(initialProps).toBeDefined();
    expect(
      (initialProps?.unsafeMetadata as Record<string, unknown> | undefined)?.requestedRole,
    ).toBeUndefined();

    const vetChip = screen.getByTestId("role-chip-vet");
    fireEvent.click(vetChip);

    const propsAfterSelect = capturedSignUpProps.at(-1);
    expect(propsAfterSelect?.unsafeMetadata).toEqual({ requestedRole: "vet" });

    // Switching selection re-tags the sign-up submission with the new role.
    const studentChip = screen.getByTestId("role-chip-student");
    fireEvent.click(studentChip);
    const propsAfterSwitch = capturedSignUpProps.at(-1);
    expect(propsAfterSwitch?.unsafeMetadata).toEqual({ requestedRole: "student" });
  });
});

describe("RoleChips — roving-focus keyboard navigation (a11y)", () => {
  beforeEach(() => {
    mockDirection = "ltr";
  });

  it("ArrowRight/ArrowLeft roves focus + selection between chips in LTR, wrapping at the ends", () => {
    render(<RoleChipsHarness />);
    const [techChip, vetChip, studentChip] = screen.getAllByRole("radio");

    techChip.focus();
    expect(document.activeElement).toBe(techChip);

    fireEvent.keyDown(techChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");
    expect(techChip.getAttribute("aria-checked")).toBe("false");

    fireEvent.keyDown(vetChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(studentChip);
    expect(studentChip.getAttribute("aria-checked")).toBe("true");

    // Wraps from the last chip back to the first.
    fireEvent.keyDown(studentChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");

    // Wraps backward from the first chip to the last.
    fireEvent.keyDown(techChip, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(studentChip);
    expect(studentChip.getAttribute("aria-checked")).toBe("true");
  });

  it("Home/End jump focus + selection to the first/last chip", () => {
    render(<RoleChipsHarness />);
    const [techChip, , studentChip] = screen.getAllByRole("radio");

    techChip.focus();
    fireEvent.keyDown(techChip, { key: "End" });
    expect(document.activeElement).toBe(studentChip);
    expect(studentChip.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(studentChip, { key: "Home" });
    expect(document.activeElement).toBe(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");
  });

  it("in RTL, ArrowLeft advances to the next chip and ArrowRight goes back (reading-direction aware)", () => {
    mockDirection = "rtl";
    render(<RoleChipsHarness />);
    const [techChip, vetChip, studentChip] = screen.getAllByRole("radio");

    techChip.focus();
    fireEvent.keyDown(techChip, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(vetChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");

    // ArrowRight from the first chip in RTL wraps backward to the last.
    fireEvent.keyDown(techChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(studentChip);
    expect(studentChip.getAttribute("aria-checked")).toBe("true");
  });

  it("roving tabindex: only the selected (or, before any selection, the first) chip is a Tab stop", () => {
    render(<RoleChipsHarness />);
    const [techChip, vetChip, studentChip] = screen.getAllByRole("radio");
    expect(techChip.tabIndex).toBe(0);
    expect(vetChip.tabIndex).toBe(-1);
    expect(studentChip.tabIndex).toBe(-1);

    fireEvent.click(vetChip);
    expect(techChip.tabIndex).toBe(-1);
    expect(vetChip.tabIndex).toBe(0);
    expect(studentChip.tabIndex).toBe(-1);
  });
});
