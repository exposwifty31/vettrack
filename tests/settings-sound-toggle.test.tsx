/**
 * @vitest-environment happy-dom
 *
 * T-41 (R-AD-02 · CLICK-PATH-022) — the Critical Alerts and role-notification
 * toggles in src/pages/settings.tsx `await`ed playFeedbackTone()/playMuteTone()
 * before persisting the toggle. If AudioContext.resume() rejects (observed on
 * iOS WKWebView), the await throws and the preference write is skipped — the
 * switch snaps back with no feedback. The sibling Master Sound toggle
 * (handleSoundToggle) was deliberately fire-and-forget; these two weren't.
 *
 * GREEN: fire the tone without awaiting so the persist always commits, and
 * report a tone failure observably (Sentry.captureMessage, mirroring the
 * use-pwa-install storage-failure pattern) — never an empty catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const captureMessageMock = vi.fn();
vi.mock("@sentry/react", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

vi.mock("@/lib/sounds", () => ({
  playFeedbackTone: vi.fn(),
  playMuteTone: vi.fn(),
  playCriticalAlertTone: vi.fn(),
}));

// SettingsPage's desktop chrome (AppShell → WebShell → PageShell → nav) is
// unrelated to the toggle-persist behavior under test — mocked to a
// passthrough so the real SettingsPage body still renders (same pattern as
// tests/settings-haptics-platform-gate.test.tsx).
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

// Role-notification toggles only render when push.subscribed is true — see
// src/pages/settings.tsx's `{push.subscribed && (...)}` gate.
const mocks = vi.hoisted(() => ({ pushSubscribed: true }));
vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => ({
    supported: true,
    permission: "granted",
    subscribed: mocks.pushSubscribed,
    loading: false,
    error: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    sendTestNotification: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

import SettingsPage from "@/pages/settings";
import { SettingsProvider } from "@/hooks/use-settings";
import { getStoredUserSettings } from "@/lib/user-settings-storage";
import { playMuteTone } from "@/lib/sounds";

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
  localStorage.clear();
  captureMessageMock.mockClear();
  vi.mocked(playMuteTone).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Settings — sound-gated toggles persist despite tone failure (T-41 · CLICK-PATH-022)", () => {
  it("persists the Critical Alerts toggle even when playMuteTone rejects, and reports it observably", async () => {
    vi.mocked(playMuteTone).mockRejectedValue(new Error("AudioContext.resume() rejected"));
    renderSettingsPage();

    // Default settings have criticalAlertsSound=true; clicking turns it off,
    // which is the branch that calls playMuteTone().
    fireEvent.click(screen.getByTestId("settings-critical-sound"));

    // The persist must commit regardless of the tone promise rejecting.
    await waitFor(() => {
      expect(getStoredUserSettings().criticalAlertsSound).toBe(false);
    });

    // The rejection must be observable, not swallowed silently.
    await waitFor(() => {
      expect(captureMessageMock).toHaveBeenCalledTimes(1);
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("persists a role-notification toggle even when playMuteTone rejects, and reports it observably", async () => {
    vi.mocked(playMuteTone).mockRejectedValue(new Error("AudioContext.resume() rejected"));
    renderSettingsPage();

    // Default role context is "technician"; technicianReturnRemindersEnabled
    // defaults to true, so clicking turns it off (playMuteTone branch).
    fireEvent.click(screen.getByTestId("settings-tech-return-reminders"));

    await waitFor(() => {
      expect(getStoredUserSettings().technicianReturnRemindersEnabled).toBe(false);
    });

    await waitFor(() => {
      expect(captureMessageMock).toHaveBeenCalled();
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("does not report anything when the tone succeeds", async () => {
    vi.mocked(playMuteTone).mockResolvedValue(undefined);
    renderSettingsPage();

    fireEvent.click(screen.getByTestId("settings-critical-sound"));

    await waitFor(() => {
      expect(getStoredUserSettings().criticalAlertsSound).toBe(false);
    });

    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
