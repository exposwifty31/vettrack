/**
 * @vitest-environment happy-dom
 *
 * T-31 (R-WEB-01) — `PlatformRouter`'s `desktop` branch (src/app/platform/PlatformRouter.tsx
 * ~L27) is a bare passthrough: any authenticated role reaching a desktop browser gets
 * the full desktop web shell, including roles that should never see it (vet_tech,
 * student). This test exercises the fix: a capability gate mounted INSIDE `AuthGuard`
 * (after auth resolves, never before it — an ungated check would misfire on the
 * loading/signed-out states AuthGuard itself owns) that denies `target === "desktop"`
 * unless `experience.can("management.web")`.
 *
 * The capability resolution itself is the REAL `experience-model.ts` (only `useAuth`
 * is mocked) so this test also pins the exact role set the card requires:
 * admin + senior_technician + lead_technician + secondary-admin pass; vet_tech and
 * student are denied.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { UserRole } from "@/types";

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  capacitorPlatform: () => "web",
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/features/auth/components/AuthGuard";

interface AuthFixture {
  role: UserRole;
  secondaryRole?: string | null;
  isAdmin: boolean;
}

function mockAuthAs({ role, secondaryRole = null, isAdmin }: AuthFixture): void {
  vi.mocked(useAuth).mockReturnValue({
    userId: "u1",
    email: "user@clinic.test",
    name: "Test User",
    role,
    secondaryRole,
    effectiveRole: role,
    roleSource: "permanent",
    activeShift: null,
    resolvedAt: null,
    status: "active",
    accessDeniedReason: null,
    isLoaded: true,
    isSignedIn: true,
    isAdmin,
    isOfflineSession: false,
    canManageErMode: false,
    signOut: vi.fn(),
    refreshAuth: vi.fn(),
  } as ReturnType<typeof useAuth>);
}

/** Desktop-shaped viewport: isTouchNarrow() must be false so the platform target
 *  resolves to "desktop" (not touch-narrow "mobile"). */
function stubMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubMatchMedia(false); // wide pointer device → desktop target on a non-marketing, non-board path
});

afterEach(() => cleanup());

function renderGuard(path = "/home") {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <AuthGuard>
        <div data-testid="protected-content">CONTENT</div>
      </AuthGuard>
    </Router>,
  );
}

describe("AuthGuard — desktop web shell gated on management.web (T-31 / R-WEB-01)", () => {
  it("denies vet_tech on desktop (lacks management.web)", () => {
    mockAuthAs({ role: "vet_tech", isAdmin: false });
    renderGuard();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("denies student on desktop (lacks management.web)", () => {
    mockAuthAs({ role: "student", isAdmin: false });
    renderGuard();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("admits admin on desktop", () => {
    mockAuthAs({ role: "admin", isAdmin: true });
    renderGuard();
    expect(screen.getByTestId("protected-content")).toBeTruthy();
  });

  it("admits senior_technician on desktop", () => {
    mockAuthAs({ role: "senior_technician", isAdmin: false });
    renderGuard();
    expect(screen.getByTestId("protected-content")).toBeTruthy();
  });

  it("admits lead_technician on desktop", () => {
    mockAuthAs({ role: "lead_technician", isAdmin: false });
    renderGuard();
    expect(screen.getByTestId("protected-content")).toBeTruthy();
  });

  it("admits a secondary-admin (non-admin permanent role, secondaryRole=admin) on desktop", () => {
    mockAuthAs({ role: "technician", secondaryRole: "admin", isAdmin: true });
    renderGuard();
    expect(screen.getByTestId("protected-content")).toBeTruthy();
  });

  it("does not gate a denied role on mobile — this is a desktop-only routing seam", () => {
    stubMatchMedia(true); // narrow coarse-pointer → mobile target
    mockAuthAs({ role: "vet_tech", isAdmin: false });
    renderGuard();
    expect(screen.getByTestId("protected-content")).toBeTruthy();
  });
});
