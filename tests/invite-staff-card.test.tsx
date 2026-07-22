/**
 * @vitest-environment happy-dom
 *
 * InviteStaffCard (PendingUsersSection) — join-code query states. The
 * regression under test: a FAILED fetch must render the loadFailed error with
 * a retry, never the noCode/generate state — otherwise "Generate code" would
 * silently rotate an existing, unseen code without the invalidation confirm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const listPendingMock = vi.fn();
const getClinicJoinCodeMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPending: (...a: unknown[]) => listPendingMock(...a),
      updateStatus: vi.fn(),
    },
  },
  getClinicJoinCode: (...a: unknown[]) => getClinicJoinCodeMock(...a),
  rotateClinicJoinCode: vi.fn().mockResolvedValue({ joinCode: "ABCD23EFGH" }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "admin-1", isAdmin: true }),
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PendingUsersSection } from "@/pages/admin/PendingUsersSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PendingUsersSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listPendingMock.mockReset().mockResolvedValue([]);
  getClinicJoinCodeMock.mockReset();
});

afterEach(() => cleanup());

describe("InviteStaffCard — join-code query states", () => {
  it("failed fetch renders loadFailed + retry and does NOT expose generate/rotate", async () => {
    getClinicJoinCodeMock.mockRejectedValue(new Error("network down"));
    renderSection();

    expect(await screen.findByTestId("invite-staff-error")).toBeTruthy();
    expect(screen.getByText(t.adminPage.inviteStaff.loadFailed)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.auth.guard.retry })).toBeTruthy();
    expect(screen.queryByTestId("btn-rotate-join-code")).toBeNull();
    expect(screen.queryByText(t.adminPage.inviteStaff.noCode)).toBeNull();
  });

  it("successful response with no code shows the noCode state with generate enabled", async () => {
    getClinicJoinCodeMock.mockResolvedValue({ joinCode: null });
    renderSection();

    expect(await screen.findByText(t.adminPage.inviteStaff.noCode)).toBeTruthy();
    expect(screen.getByTestId("btn-rotate-join-code")).toBeTruthy();
    expect(screen.queryByTestId("invite-staff-error")).toBeNull();
  });

  it("successful response with a code shows the code and the copy/rotate controls", async () => {
    getClinicJoinCodeMock.mockResolvedValue({ joinCode: "ABCD23EFGH" });
    renderSection();

    expect(await screen.findByTestId("clinic-join-code")).toBeTruthy();
    expect(screen.getByText("ABCD23EFGH")).toBeTruthy();
    expect(screen.getByTestId("btn-copy-join-link")).toBeTruthy();
    expect(screen.getByTestId("btn-rotate-join-code")).toBeTruthy();
  });
});
