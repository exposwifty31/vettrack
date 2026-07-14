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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { t } from "@/lib/i18n";

const isOnlineMock = vi.fn();
const safeReloadPageMock = vi.fn();
vi.mock("@/lib/safe-browser", () => ({
  isOnline: () => isOnlineMock(),
  safeReloadPage: (...args: unknown[]) => safeReloadPageMock(...args),
}));

import { OfflineAuthGate } from "@/components/offline-auth-gate";

function renderGate() {
  return render(
    <OfflineAuthGate>
      <div data-testid="clerk-form">clerk</div>
    </OfflineAuthGate>,
  );
}

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
    renderGate();
    expect(screen.getByTestId("clerk-form")).toBeTruthy();
    expect(screen.queryByTestId("offline-auth-gate")).toBeNull();
  });

  it("swaps the children for the offline prompt when an `offline` event fires", () => {
    isOnlineMock.mockReturnValue(true);
    renderGate();
    expect(screen.getByTestId("clerk-form")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByTestId("offline-auth-gate")).toBeTruthy();
    expect(screen.queryByTestId("clerk-form")).toBeNull();
  });

  it("attempts a reload when an `online` event fires", () => {
    isOnlineMock.mockReturnValue(false);
    safeReloadPageMock.mockReturnValue(true);
    renderGate();
    expect(screen.getByTestId("offline-auth-gate")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
  });

  it("attempts a reload when the Retry button is pressed", () => {
    isOnlineMock.mockReturnValue(false);
    safeReloadPageMock.mockReturnValue(true);
    renderGate();

    fireEvent.click(screen.getByText(t.auth.guard.offlineRetry));

    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
  });

  it("unblocks (shows children) when the reconnect reload is suppressed but connectivity is back", () => {
    // The 5s reload guard returns false; the gate must not stay stuck offline.
    isOnlineMock.mockReturnValue(false);
    safeReloadPageMock.mockReturnValue(false);
    renderGate();
    expect(screen.getByTestId("offline-auth-gate")).toBeTruthy();

    isOnlineMock.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.getByTestId("clerk-form")).toBeTruthy();
    expect(screen.queryByTestId("offline-auth-gate")).toBeNull();
  });

  it("stays on the offline prompt when the reload is suppressed and still offline", () => {
    isOnlineMock.mockReturnValue(false);
    safeReloadPageMock.mockReturnValue(false);
    renderGate();
    expect(screen.getByTestId("offline-auth-gate")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.getByTestId("offline-auth-gate")).toBeTruthy();
    expect(screen.queryByTestId("clerk-form")).toBeNull();
  });
});
