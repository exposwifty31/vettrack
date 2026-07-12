/**
 * @vitest-environment happy-dom
 *
 * T12 (LOW audit sweep) — the "Haptics" settings toggle rendered
 * unconditionally, including on desktop web where haptic feedback is a
 * no-op. Settings now gates it behind the shared platform seam
 * (`usePlatformTarget()` from `src/app/platform`, the same seam
 * `tests/platform-target.test.ts` and `tests/platform-router.test.tsx`
 * exercise) so it only renders on a touch/native surface.
 *
 * The Haptics toggle it renders no differently is the pre-existing
 * `SettingsToggle` covered by tests/settings-sound-toggle-no-remount.test.tsx
 * — this test is scoped to the platform gate, not toggle mechanics.
 *
 * SettingsPage pulls in the full desktop chrome (AppShell → WebShell →
 * PageShell → nav) which is unrelated to this gate, so AppShell is mocked
 * to a passthrough — mirroring how heavy pages are kept out of focused
 * render tests elsewhere in this suite (see the equipment-detail i18n
 * source-contract tests) while still exercising the REAL SettingsPage body.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Toggle isCapacitorNative per-test (vi.hoisted avoids the TDZ error a bare
// closure would hit inside a hoisted vi.mock factory) — same pattern as
// tests/platform-target.test.ts.
const mocks = vi.hoisted(() => ({ isNative: false }));
vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => mocks.isNative,
  capacitorPlatform: () => (mocks.isNative ? "ios" : "web"),
}));

// SettingsPage's desktop chrome (AppShell → WebShell → PageShell → nav) is
// unrelated to the haptics platform gate under test — mocked to a
// passthrough so the real SettingsPage body still renders.
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    userId: "u1",
    email: "tech@clinic.test",
    name: "Test Technician",
    role: "technician",
    secondaryRole: null,
    effectiveRole: "technician",
    roleSource: "permanent",
    activeShift: null,
    resolvedAt: null,
    status: null,
    accessDeniedReason: null,
    isLoaded: true,
    isSignedIn: true,
    isAdmin: false,
    isOfflineSession: false,
    canManageErMode: false,
    signOut: vi.fn(),
    refreshAuth: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => ({
    supported: false,
    permission: "unsupported",
    subscribed: false,
    loading: false,
    error: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    updateSettings: vi.fn(),
    sendTestNotification: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

import SettingsPage from "@/pages/settings";
import { SettingsProvider } from "@/hooks/use-settings";

/** Force isTouchNarrow()'s matchMedia probe to a known result. */
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

function renderSettingsPage() {
  const { hook } = memoryLocation({ path: "/settings" });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <SettingsProvider>
          <SettingsPage />
        </SettingsProvider>
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.isNative = false;
  stubMatchMedia(false); // wide pointer device by default (desktop)
});

afterEach(() => cleanup());

describe("Settings — haptics toggle platform gate (T12)", () => {
  it("is NOT rendered on desktop web (not native, wide pointer)", () => {
    renderSettingsPage();
    expect(screen.queryByTestId("settings-haptics")).toBeNull();
  });

  it("IS rendered inside the Capacitor native shell", () => {
    mocks.isNative = true;
    renderSettingsPage();
    expect(screen.getByTestId("settings-haptics")).toBeTruthy();
  });

  it("IS rendered on a narrow coarse-pointer (touch) browser viewport, even without native", () => {
    stubMatchMedia(true); // simulates (max-width: 767px) and (pointer: coarse)
    renderSettingsPage();
    expect(screen.getByTestId("settings-haptics")).toBeTruthy();
  });
});
