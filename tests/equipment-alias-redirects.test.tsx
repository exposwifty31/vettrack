/**
 * @vitest-environment happy-dom
 *
 * T-38 (R-SY-04 / CLICK-PATH-026) — the `/equipment/scan`, `/equipment/maintenance`,
 * and `/equipment/intelligence` alias redirects in src/app/routes.tsx were declared
 * AFTER the dynamic `/equipment/:id` route. wouter's <Switch> matches top-down, so
 * `:id` matched first (id="scan", id="maintenance", id="intelligence") and the
 * alias redirects never fired — visiting any of these paths landed on the
 * equipment detail page (treating the alias segment as an equipment id) instead
 * of the intended destination. This test pins the fixed order: each alias must
 * resolve to its intended target, never to the `:id` detail page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Suspense } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  capacitorPlatform: () => "web",
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/pages/equipment-list", () => ({
  default: () => <div data-testid="equipment-list-page" />,
}));

vi.mock("@/pages/equipment-detail", () => ({
  default: () => <div data-testid="equipment-detail-page" />,
}));

import { useAuth } from "@/hooks/use-auth";
import { AppRoutes } from "@/app/routes";

/** Narrow coarse-pointer viewport → mobile platform target, so AuthGuard's
 *  desktop-only management.web gate never engages for these routes. */
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
  stubMatchMedia(true);
  vi.mocked(useAuth).mockReturnValue({
    userId: "u1",
    email: "user@clinic.test",
    name: "Test User",
    role: "admin",
    secondaryRole: null,
    effectiveRole: "admin",
    roleSource: "permanent",
    activeShift: null,
    resolvedAt: null,
    status: "active",
    accessDeniedReason: null,
    isLoaded: true,
    isSignedIn: true,
    isAdmin: true,
    isOfflineSession: false,
    canManageErMode: false,
    signOut: vi.fn(),
    refreshAuth: vi.fn(),
  } as ReturnType<typeof useAuth>);
});

afterEach(() => cleanup());

function renderAt(path: string) {
  const { hook, history } = memoryLocation({ path, record: true });
  render(
    <Suspense fallback={<div data-testid="route-fallback" />}>
      <Router hook={hook}>
        <AppRoutes />
      </Router>
    </Suspense>,
  );
  return history;
}

describe("Equipment alias redirects ordered above /equipment/:id (T-38 / R-SY-04)", () => {
  it("/equipment/scan resolves to the equipment list (scan mode), not the :id detail page", async () => {
    const history = renderAt("/equipment/scan");
    expect(await screen.findByTestId("equipment-list-page")).toBeTruthy();
    expect(screen.queryByTestId("equipment-detail-page")).toBeNull();
    expect(history[history.length - 1]).toBe("/equipment?scan=1");
  });

  it("/equipment/maintenance resolves to the equipment list (maintenance filter), not the :id detail page", async () => {
    const history = renderAt("/equipment/maintenance");
    expect(await screen.findByTestId("equipment-list-page")).toBeTruthy();
    expect(screen.queryByTestId("equipment-detail-page")).toBeNull();
    expect(history[history.length - 1]).toBe("/equipment?status=maintenance");
  });

  it("/equipment/intelligence resolves to the equipment list, not the :id detail page", async () => {
    const history = renderAt("/equipment/intelligence");
    expect(await screen.findByTestId("equipment-list-page")).toBeTruthy();
    expect(screen.queryByTestId("equipment-detail-page")).toBeNull();
    expect(history[history.length - 1]).toBe("/equipment");
  });
});
