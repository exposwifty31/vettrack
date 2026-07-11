/**
 * @vitest-environment happy-dom
 *
 * T24b — the admin pending-users list surfaces the role a user requested at
 * sign-up as a READ-ONLY hint. It must NOT auto-apply that role: approving a
 * pending user only flips their status (existing behavior), the admin still
 * grants the real role separately.
 *
 * Non-vacuous: a pending user with requestedRole "vet" renders the localized
 * hint; a pending user without a requested role renders no hint; and clicking
 * Approve calls updateStatus(id, "active") only — never updateRole.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const listPendingMock = vi.fn();
const updateStatusMock = vi.fn();
const updateRoleMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPending: (...a: unknown[]) => listPendingMock(...a),
      updateStatus: (...a: unknown[]) => updateStatusMock(...a),
      updateRole: (...a: unknown[]) => updateRoleMock(...a),
    },
  },
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
  listPendingMock.mockReset();
  updateStatusMock.mockReset().mockResolvedValue({});
  updateRoleMock.mockReset();
});

afterEach(() => cleanup());

describe("PendingUsersSection — requested-role hint (T24b)", () => {
  it("renders the localized requested-role hint for a user who requested 'vet'", async () => {
    listPendingMock.mockResolvedValue([
      {
        id: "u-1",
        clerkId: "c-1",
        email: "vetwannabe@clinic.example",
        name: "Vet Wannabe",
        displayName: "Vet Wannabe",
        role: "technician",
        requestedRole: "vet",
        status: "pending",
        createdAt: "2026-07-10T10:00:00.000Z",
      },
    ]);

    renderSection();

    const hint = await screen.findByTestId("requested-role-hint-u-1");
    // Localized "Requested: {role}" with the veterinarian label interpolated.
    expect(hint.textContent).toContain(t.adminPage.roleVet);
    expect(hint.textContent).toContain(t.adminPage.requestedRoleHint(t.adminPage.roleVet));
  });

  it("renders no hint when the pending user has no requested role", async () => {
    listPendingMock.mockResolvedValue([
      {
        id: "u-2",
        clerkId: "c-2",
        email: "norole@clinic.example",
        name: "No Role",
        displayName: "No Role",
        role: "technician",
        requestedRole: null,
        status: "pending",
        createdAt: "2026-07-10T10:00:00.000Z",
      },
    ]);

    renderSection();

    // Row present, but the requested-role hint is not rendered.
    expect(await screen.findByTestId("pending-user-row-u-2")).toBeTruthy();
    expect(screen.queryByTestId("requested-role-hint-u-2")).toBeNull();
  });

  it("approval only changes status — it never applies the requested role", async () => {
    listPendingMock.mockResolvedValue([
      {
        id: "u-3",
        clerkId: "c-3",
        email: "vetwannabe@clinic.example",
        name: "Vet Wannabe",
        displayName: "Vet Wannabe",
        role: "technician",
        requestedRole: "vet",
        status: "pending",
        createdAt: "2026-07-10T10:00:00.000Z",
      },
    ]);

    renderSection();

    const approveBtn = await screen.findByTestId("btn-approve-user-u-3");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith("u-3", "active"));
    // The requested role is advisory: approval must not promote the user to it.
    expect(updateRoleMock).not.toHaveBeenCalled();
  });
});
