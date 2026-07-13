/**
 * @vitest-environment happy-dom
 *
 * T-12 (offline cold-start, real-device finding 2026-07-13): on a fresh launch
 * in airplane mode the native Clerk gate spun on an infinite skeleton — clerk-js
 * can't reach Clerk's API offline, so `ClerkLoading` never resolves and
 * `ClerkFailed` never fires (offline is not a script-load failure). The gate
 * must instead surface a "connect to sign in" prompt while offline.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { t } from "@/lib/i18n";

vi.mock("@/lib/capacitor-runtime", () => ({ isCapacitorNative: () => true }));

const isOnlineMock = vi.fn();
const safeReloadPageMock = vi.fn();
vi.mock("@/lib/safe-browser", () => ({
  isOnline: () => isOnlineMock(),
  safeReloadPage: () => safeReloadPageMock(),
}));

// Simulate Clerk still "loading" (offline can't resolve): ClerkLoading renders
// its children; the other states render nothing.
vi.mock("@clerk/clerk-react", () => ({
  ClerkLoading: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClerkLoaded: () => null,
  ClerkFailed: () => null,
}));

import { NativeClerkGate } from "@/components/native-clerk-gate";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NativeClerkGate — offline cold-start (T-12)", () => {
  it("shows a 'connect to sign in' prompt instead of an infinite skeleton when offline", () => {
    isOnlineMock.mockReturnValue(false);
    render(
      <NativeClerkGate>
        <div>app</div>
      </NativeClerkGate>,
    );
    expect(screen.getByTestId("clerk-offline-gate")).toBeTruthy();
    expect(screen.getByText(t.auth.guard.offlineTitle)).toBeTruthy();
    expect(screen.getByText(t.auth.guard.offlineBody)).toBeTruthy();
  });

  it("does not show the offline prompt while genuinely loading online", () => {
    isOnlineMock.mockReturnValue(true);
    render(
      <NativeClerkGate>
        <div>app</div>
      </NativeClerkGate>,
    );
    expect(screen.queryByTestId("clerk-offline-gate")).toBeNull();
  });
});
