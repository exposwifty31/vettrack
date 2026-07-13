/**
 * @vitest-environment happy-dom
 *
 * Role-preselect signup (C3): the sign-in/up role chips (`RoleChips.tsx`)
 * offer the two self-selectable roles (technician, vet); the chosen role is
 * carried into the Clerk sign-up submission via `unsafeMetadata` (Clerk's own
 * mechanism for attaching data to a new account), reusing the existing Clerk
 * `<SignUp/>` flow. Admin approval later promotes the account to that role.
 *
 * Non-vacuous: against inert `RoleChips`, chips render as plain `<span>`s with
 * no `radio` role and no click handler, so the "select a chip" step could not
 * occur, and the sign-up flow would never pass `unsafeMetadata` — the
 * assertion on `capturedSignUpProps` would fail (prop absent), not pass
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

let mockDirection: "ltr" | "rtl" = "ltr";
vi.mock("@/hooks/useDirection", () => ({
  useDirection: () => mockDirection,
}));

const capturedSignUpProps: Array<Record<string, unknown>> = [];

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
  sessionStorage.clear();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_stub_key");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("RoleChips — sign-up role pre-selection (C3)", () => {
  it("renders the two self-selectable chips as a radiogroup, not inert spans", () => {
    render(<RoleChipsHarness />);
    const group = screen.getByRole("radiogroup");
    const chips = within(group).getAllByRole("radio");
    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.tagName === "BUTTON")).toBe(true);
    expect(screen.queryByTestId("role-chip-student")).toBeNull();
  });

  it("selecting a chip pre-selects that role (single-select, aria-checked reflects choice)", () => {
    render(<RoleChipsHarness />);
    const vetChip = screen.getByTestId("role-chip-vet");
    const techChip = screen.getByTestId("role-chip-technician");

    expect(vetChip.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");
    expect(techChip.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");
    expect(vetChip.getAttribute("aria-checked")).toBe("false");
  });

  it("does not render as a selectable control when mounted without a selection handler", () => {
    render(<NonInteractiveRoleChipsHarness />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(t.authPage.roleVeterinarian).tagName).toBe("SPAN");
  });

  it("carries the selected role (technician, no license needed) into the sign-up submission", async () => {
    await renderSignUpPage();

    // Before any selection, no requested role is attached to the sign-up call.
    expect(capturedSignUpProps.at(-1)?.unsafeMetadata).toBeUndefined();

    // Technician needs no license, so the Clerk form carries the role directly.
    fireEvent.click(screen.getByTestId("role-chip-technician"));
    expect(capturedSignUpProps.at(-1)?.unsafeMetadata).toEqual({ requestedRole: "technician" });
  });

  it("shows the vet license field when vet is selected and carries it into the submission", async () => {
    await renderSignUpPage();
    expect(screen.queryByTestId("vet-license-input")).toBeNull();

    fireEvent.click(screen.getByTestId("role-chip-vet"));
    fireEvent.change(screen.getByTestId("vet-license-input"), { target: { value: "MD-9911" } });

    expect(capturedSignUpProps.at(-1)?.unsafeMetadata).toEqual({
      requestedRole: "vet",
      vetLicenseNumber: "MD-9911",
    });

    // Switching to tech drops both the field and the license from the submission.
    fireEvent.click(screen.getByTestId("role-chip-technician"));
    expect(screen.queryByTestId("vet-license-input")).toBeNull();
    expect(capturedSignUpProps.at(-1)?.unsafeMetadata).toEqual({ requestedRole: "technician" });
  });

  it("gates the sign-up form: vet with no (or too-short) license shows the gate, not the Clerk form", async () => {
    await renderSignUpPage();

    fireEvent.click(screen.getByTestId("role-chip-vet"));
    // Vet selected, license empty → the gate replaces the Clerk sign-up form.
    expect(screen.getByTestId("vet-license-gate")).toBeTruthy();
    expect(screen.queryByTestId("clerk-sign-up-stub")).toBeNull();

    // A too-short license is still gated.
    fireEvent.change(screen.getByTestId("vet-license-input"), { target: { value: "x" } });
    expect(screen.getByTestId("vet-license-gate")).toBeTruthy();

    // A valid license opens the form.
    fireEvent.change(screen.getByTestId("vet-license-input"), { target: { value: "MD-100" } });
    expect(screen.queryByTestId("vet-license-gate")).toBeNull();
    expect(screen.getByTestId("clerk-sign-up-stub")).toBeTruthy();
  });
});

describe("RoleChips — roving-focus keyboard navigation (a11y)", () => {
  beforeEach(() => {
    mockDirection = "ltr";
  });

  it("ArrowRight/ArrowLeft roves focus + selection between chips in LTR, wrapping at the ends", () => {
    render(<RoleChipsHarness />);
    const [techChip, vetChip] = screen.getAllByRole("radio");

    techChip.focus();
    expect(document.activeElement).toBe(techChip);

    fireEvent.keyDown(techChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");
    expect(techChip.getAttribute("aria-checked")).toBe("false");

    // Wraps from the last chip back to the first.
    fireEvent.keyDown(vetChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");

    // Wraps backward from the first chip to the last.
    fireEvent.keyDown(techChip, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");
  });

  it("Home/End jump focus + selection to the first/last chip", () => {
    render(<RoleChipsHarness />);
    const [techChip, vetChip] = screen.getAllByRole("radio");

    techChip.focus();
    fireEvent.keyDown(techChip, { key: "End" });
    expect(document.activeElement).toBe(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(vetChip, { key: "Home" });
    expect(document.activeElement).toBe(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");
  });

  it("in RTL, ArrowLeft advances to the next chip and ArrowRight goes back (reading-direction aware)", () => {
    mockDirection = "rtl";
    render(<RoleChipsHarness />);
    const [techChip, vetChip] = screen.getAllByRole("radio");

    techChip.focus();
    fireEvent.keyDown(techChip, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(vetChip);
    expect(vetChip.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(vetChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(techChip);
    expect(techChip.getAttribute("aria-checked")).toBe("true");
  });

  it("roving tabindex: only the selected (or, before any selection, the first) chip is a Tab stop", () => {
    render(<RoleChipsHarness />);
    const [techChip, vetChip] = screen.getAllByRole("radio");
    expect(techChip.tabIndex).toBe(0);
    expect(vetChip.tabIndex).toBe(-1);

    fireEvent.click(vetChip);
    expect(techChip.tabIndex).toBe(-1);
    expect(vetChip.tabIndex).toBe(0);
  });
});
