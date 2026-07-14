/**
 * @vitest-environment happy-dom
 *
 * T-45 (CLICK-PATH-027) — the version-check effect in update-banner.tsx ran an
 * async IIFE with no supersede guard. If auth changes while the version fetch
 * is in flight, the effect re-runs, but the FIRST (now stale) resolve could
 * still call setBannerVersion — surfacing a banner from a superseded run.
 * The fix captures an ignore-flag in the effect, checks it before setState, and
 * flips it in the cleanup so a stale resolve after re-run/unmount is discarded.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

let authValue = { isSignedIn: true, userId: "u1" };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authValue }));
vi.mock("@/app/platform", () => ({ resolvePlatformTarget: () => "desktop" }));
vi.mock("@/lib/safe-browser", () => ({
  safeStorageGetItem: () => null,
  safeStorageSetItem: vi.fn(),
}));

const resolveServerAppVersionMock = vi.fn();
vi.mock("@/lib/app-version", () => ({
  resolveServerAppVersion: (...a: unknown[]) => resolveServerAppVersionMock(...a),
  resolveDisplayAppVersion: vi.fn(),
  getBundledAppVersion: () => "0.0.0",
  compareVersions: (a: string, b: string) => (a === b ? 0 : a > b ? 1 : -1),
}));

import { UpdateBanner } from "@/components/update-banner";

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authValue = { isSignedIn: true, userId: "u1" };
});

describe("UpdateBanner — supersede guard (T-45)", () => {
  it("discards a stale version resolve after the effect re-ran on an auth change", async () => {
    const d1 = deferred();
    const d2 = deferred();
    resolveServerAppVersionMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    authValue = { isSignedIn: true, userId: "u1" };
    const { rerender } = render(<UpdateBanner />);

    // Auth changes → the effect re-runs (cleanup of run 1, then run 2 starts).
    authValue = { isSignedIn: true, userId: "u2" };
    rerender(<UpdateBanner />);

    // The FIRST (now superseded) run resolves late with a bannerable version.
    await act(async () => {
      d1.resolve("9.9.9");
      await Promise.resolve();
    });

    // A superseded resolve must NOT surface the banner.
    expect(screen.queryByTestId("update-banner")).toBeNull();

    // The live (second) run still surfaces the banner normally.
    await act(async () => {
      d2.resolve("9.9.9");
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("update-banner")).toBeTruthy());
  });
});
