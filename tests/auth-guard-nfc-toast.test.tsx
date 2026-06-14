/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const toastErrorMock = vi.fn();
const toastDismissMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  t: {
    nfcEntry: {
      signInFirst: "Sign in first, then re-scan the tag.",
      openingEquipment: "Opening equipment…",
    },
    common: {
      loading: "Loading...",
    },
    auth: {
      guard: {
        reasons: {},
        loadingApp: "Loading…",
        pendingTitle: "Pending",
        pendingBody: "Pending body",
        blockedTitle: "Blocked",
        blockedBody: "Blocked body",
        accessDeniedTitle: "Denied",
        accessDeniedBody: "Denied body",
        retry: "Retry",
        signOut: "Sign out",
      },
    },
  },
}));

import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/features/auth/components/AuthGuard";

const storage = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.mocked(useAuth).mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    status: "pending",
    accessDeniedReason: null,
    signOut: vi.fn(),
    refreshAuth: vi.fn(),
  } as ReturnType<typeof useAuth>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderGuard(path: string) {
  const loc = memoryLocation({ path });
  render(
    <Router hook={loc.hook}>
      <AuthGuard>
        <div data-testid="child">protected</div>
      </AuthGuard>
    </Router>,
  );
  return loc;
}

describe("AuthGuard NFC sign-in toast", () => {
  it("B1: logged-out + nfcAction=toggle → toast.error once + dismiss nfc-open", () => {
    renderGuard("/equipment/abc?nfcAction=toggle&nfcTs=1");
    expect(toastDismissMock).toHaveBeenCalledWith("nfc-open");
    expect(toastErrorMock).toHaveBeenCalledWith("Sign in first, then re-scan the tag.");
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it("D6: re-render within 8s → toast not called again; after TTL clear → fires again", () => {
    const loc = renderGuard("/equipment/abc?nfcAction=toggle&nfcTs=1");
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    toastErrorMock.mockClear();
    toastDismissMock.mockClear();
    loc.navigate("/equipment/abc?nfcAction=toggle&nfcTs=2");
    render(
      <Router hook={loc.hook}>
        <AuthGuard>
          <div>protected</div>
        </AuthGuard>
      </Router>,
    );
    expect(toastErrorMock).not.toHaveBeenCalled();

    storage.delete("vt_nfc_signin_toast_shown");
    toastErrorMock.mockClear();
    loc.navigate("/equipment/abc?nfcAction=toggle&nfcTs=3");
    render(
      <Router hook={loc.hook}>
        <AuthGuard>
          <div>protected</div>
        </AuthGuard>
      </Router>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});
