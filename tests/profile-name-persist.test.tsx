/**
 * @vitest-environment happy-dom
 *
 * Regression (T-39 · R-PR-01 · CLICK-PATH-008): saving the display name only
 * invalidated the `me` query (`/api/users/me`) — but the header renders
 * `useAuth().name`, a SEPARATE fetch/context. The label flashed the new name
 * (via the transient `saved` state) then reverted once that state cleared,
 * because auth context was never told to refetch. Fix: call `refreshAuth()`
 * after a successful save so `useAuth().name` actually updates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const updateDisplayNameMock = vi.fn();
const refreshAuthMock = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ name: "Dana Vet", role: "admin", userId: "u1", refreshAuth: refreshAuthMock }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    users: {
      me: vi.fn(),
      uploadAvatar: vi.fn(),
      updateDisplayName: (...a: unknown[]) => updateDisplayNameMock(...a),
    },
  },
}));

import { ProfileHeroZone } from "@/features/profile/ProfileHeroZone";

function renderHero() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/users/me"], { avatarUrl: null });
  return render(
    <QueryClientProvider client={qc}>
      <ProfileHeroZone />
    </QueryClientProvider>,
  );
}

describe("ProfileHeroZone — display-name save persists in header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateDisplayNameMock.mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it("calls refreshAuth after a successful display-name save", async () => {
    renderHero();

    fireEvent.click(screen.getByLabelText(t.profile.editDisplayName));
    const input = screen.getByLabelText(t.profile.editDisplayName) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dana New" } });
    fireEvent.click(screen.getByLabelText(t.common.save));

    await waitFor(() => expect(updateDisplayNameMock).toHaveBeenCalledWith("u1", "Dana New"));
    await waitFor(() => expect(refreshAuthMock).toHaveBeenCalledTimes(1));
  });

  it("does not call refreshAuth when the save fails", async () => {
    updateDisplayNameMock.mockRejectedValueOnce(new Error("network down"));
    renderHero();

    fireEvent.click(screen.getByLabelText(t.profile.editDisplayName));
    const input = screen.getByLabelText(t.profile.editDisplayName) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dana New" } });
    fireEvent.click(screen.getByLabelText(t.common.save));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refreshAuthMock).not.toHaveBeenCalled();
  });
});
