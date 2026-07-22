/**
 * @vitest-environment happy-dom
 *
 * AuthGuard × clinic join codes — a MISSING_CLINIC_ID session renders the
 * JoinClinicScreen (invite-free membership step) instead of the generic
 * access-denied dead end; every other denial reason keeps the denied screen.
 * A join code carried from the invite link auto-submits once, and a manual
 * submit flows through joinClinic → refreshAuth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const joinClinicMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), dismiss: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  joinClinic: (...args: unknown[]) => joinClinicMock(...args),
}));

import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/features/auth/components/AuthGuard";
import { t } from "@/lib/i18n";

const storage = new Map<string, string>();

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>>): {
  signOut: ReturnType<typeof vi.fn>;
  refreshAuth: ReturnType<typeof vi.fn>;
} {
  const signOut = vi.fn();
  const refreshAuth = vi.fn();
  vi.mocked(useAuth).mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    status: null,
    accessDeniedReason: null,
    signOut,
    refreshAuth,
    ...overrides,
  } as ReturnType<typeof useAuth>);
  return { signOut, refreshAuth };
}

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderGuard() {
  const loc = memoryLocation({ path: "/home" });
  render(
    <Router hook={loc.hook}>
      <AuthGuard>
        <div data-testid="child">protected</div>
      </AuthGuard>
    </Router>,
  );
}

describe("AuthGuard — MISSING_CLINIC_ID join step", () => {
  it("renders the join screen, not the generic denied screen", () => {
    mockAuth({ accessDeniedReason: "MISSING_CLINIC_ID" });
    renderGuard();

    expect(screen.getByText(t.auth.joinClinic.title)).toBeTruthy();
    expect(screen.queryByText(t.auth.guard.accessDeniedTitle)).toBeNull();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("keeps the generic denied screen for every other reason", () => {
    mockAuth({ accessDeniedReason: "TENANT_MISMATCH" });
    renderGuard();

    expect(screen.getByText(t.auth.guard.accessDeniedTitle)).toBeTruthy();
    expect(screen.queryByText(t.auth.joinClinic.title)).toBeNull();
  });

  it("manual submit joins and triggers refreshAuth; carried code is cleared", async () => {
    joinClinicMock.mockResolvedValue({ ok: true, status: "pending" });
    const { refreshAuth } = mockAuth({ accessDeniedReason: "MISSING_CLINIC_ID" });
    renderGuard();

    fireEvent.change(screen.getByLabelText(t.auth.joinClinic.codeLabel), {
      target: { value: "abcd23efgh" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.auth.joinClinic.submit }));

    await waitFor(() => expect(refreshAuth).toHaveBeenCalledTimes(1));
    expect(joinClinicMock).toHaveBeenCalledWith("ABCD23EFGH");
    expect(storage.has("vt_clinic_join_code")).toBe(false);
  });

  it("invalid code shows the invalid-code error and does not refresh", async () => {
    joinClinicMock.mockResolvedValue({ ok: false, reason: "INVALID_JOIN_CODE" });
    const { refreshAuth } = mockAuth({ accessDeniedReason: "MISSING_CLINIC_ID" });
    renderGuard();

    fireEvent.change(screen.getByLabelText(t.auth.joinClinic.codeLabel), {
      target: { value: "ABCD23EFGH" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.auth.joinClinic.submit }));

    expect(await screen.findByText(t.auth.joinClinic.invalidCode)).toBeTruthy();
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it("a carried join code from the invite link auto-submits once", async () => {
    storage.set("vt_clinic_join_code", "ABCD23EFGH");
    joinClinicMock.mockResolvedValue({ ok: true, status: "pending" });
    const { refreshAuth } = mockAuth({ accessDeniedReason: "MISSING_CLINIC_ID" });
    renderGuard();

    await waitFor(() => expect(joinClinicMock).toHaveBeenCalledWith("ABCD23EFGH"));
    expect(joinClinicMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refreshAuth).toHaveBeenCalledTimes(1));
    expect(storage.has("vt_clinic_join_code")).toBe(false);
  });
});
