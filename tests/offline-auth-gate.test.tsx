/**
 * @vitest-environment happy-dom
 *
 * Real-device finding (2026-07-13): in airplane mode the sign-in screen rendered
 * the Clerk `<SignIn>` (clerk-js was cached, so the gate reached ClerkLoaded),
 * and Clerk fired its own "No Internet Connection" toast over a blank form.
 * `OfflineAuthGate` must render the graceful connect-to-sign-in prompt INSTEAD of
 * the Clerk component while offline, so clerk-js never mounts and never toasts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { t } from "@/lib/i18n";

const isOnlineMock = vi.fn();
vi.mock("@/lib/safe-browser", () => ({
  isOnline: () => isOnlineMock(),
  safeReloadPage: vi.fn(),
}));

import { OfflineAuthGate } from "@/components/offline-auth-gate";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OfflineAuthGate", () => {
  it("renders the connect-to-sign-in prompt (not the Clerk form) while offline", () => {
    isOnlineMock.mockReturnValue(false);
    render(
      <OfflineAuthGate>
        <div data-testid="clerk-form">clerk</div>
      </OfflineAuthGate>,
    );
    expect(screen.getByTestId("offline-auth-gate")).toBeTruthy();
    expect(screen.getByText(t.auth.guard.offlineTitle)).toBeTruthy();
    // The Clerk form is NOT mounted → it cannot fire its own offline toast.
    expect(screen.queryByTestId("clerk-form")).toBeNull();
  });

  it("renders the children (auth form) while online", () => {
    isOnlineMock.mockReturnValue(true);
    render(
      <OfflineAuthGate>
        <div data-testid="clerk-form">clerk</div>
      </OfflineAuthGate>,
    );
    expect(screen.getByTestId("clerk-form")).toBeTruthy();
    expect(screen.queryByTestId("offline-auth-gate")).toBeNull();
  });
});
