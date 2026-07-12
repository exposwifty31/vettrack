/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit PR #83 finding (use-pwa-install.ts ~67-72 + dismissAndroidBanner)
 * — a failed sessionStorage read/write for the Android install-banner
 * dismissal flag must stay non-fatal (banner behavior degrades gracefully)
 * but must no longer be silently swallowed: it should be reported via the
 * app's existing Sentry diagnostic path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const captureMessageMock = vi.fn();
vi.mock("@sentry/react", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

import { usePwaInstall } from "@/hooks/use-pwa-install";

function stubThrowingSessionStorage(method: "getItem" | "setItem") {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => {
      if (method === "getItem") throw new Error("storage disabled");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (method === "setItem") throw new Error("storage disabled");
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
}

describe("usePwaInstall — Android banner storage-failure observability", () => {
  beforeEach(() => {
    captureMessageMock.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports (but does not throw on) a failed sessionStorage read, falling back to not-suppressed", () => {
    stubThrowingSessionStorage("getItem");

    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.androidDismissed).toBe(false);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("sessionStorage read failed"),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("reports (but does not throw on) a failed sessionStorage write, keeping the in-memory dismissal", () => {
    stubThrowingSessionStorage("setItem");

    const { result } = renderHook(() => usePwaInstall());
    expect(captureMessageMock).not.toHaveBeenCalled();

    act(() => {
      result.current.dismissAndroidBanner();
    });

    expect(result.current.androidDismissed).toBe(true);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("sessionStorage write failed"),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("does not report anything when storage works normally", () => {
    const { result } = renderHook(() => usePwaInstall());
    act(() => {
      result.current.dismissAndroidBanner();
    });
    expect(result.current.androidDismissed).toBe(true);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
