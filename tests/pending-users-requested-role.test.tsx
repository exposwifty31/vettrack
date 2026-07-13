/**
 * @vitest-environment happy-dom
 *
 * C3 — the admin pending-users list surfaces the role a user requested at
 * sign-up and, on approval, promotes the user to it (the admin no longer
 * re-selects the role). For a vet request the license number is shown for
 * verification, and the admin can override the granted role before approving.
 *
 * Non-vacuous: a pending vet renders the localized hint + license; approving
 * calls updateStatus(id, "active", <role>) with the granted role; and the
 * override select changes which role is sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const listPendingMock = vi.fn();
const updateStatusMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPending: (...a: unknown[]) => listPendingMock(...a),
      updateStatus: (...a: unknown[]) => updateStatusMock(...a),
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

function pendingUser(overrides: Record<string, unknown>) {
  return {
    id: "u-1",
    clerkId: "c-1",
    email: "vetwannabe@clinic.example",
    name: "Vet Wannabe",
    displayName: "Vet Wannabe",
    role: "technician",
    requestedRole: "vet",
    vetLicenseNumber: null,
    status: "pending",
    createdAt: "2026-07-10T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  listPendingMock.mockReset();
  updateStatusMock.mockReset().mockResolvedValue({});
});

afterEach(() => cleanup());

describe("PendingUsersSection — role-preselect approval (C3)", () => {
  it("renders the localized requested-role hint for a user who requested 'vet'", async () => {
    listPendingMock.mockResolvedValue([pendingUser({ id: "u-1" })]);
    renderSection();

    const hint = await screen.findByTestId("requested-role-hint-u-1");
    expect(hint.textContent).toContain(t.adminPage.roleVet);
    expect(hint.textContent).toContain(t.adminPage.requestedRoleHint(t.adminPage.roleVet));
  });

  it("renders no hint when the pending user has no requested role", async () => {
    listPendingMock.mockResolvedValue([pendingUser({ id: "u-2", requestedRole: null })]);
    renderSection();

    expect(await screen.findByTestId("pending-user-row-u-2")).toBeTruthy();
    expect(screen.queryByTestId("requested-role-hint-u-2")).toBeNull();
  });

  it("shows the vet license number for admin verification", async () => {
    listPendingMock.mockResolvedValue([pendingUser({ id: "u-5", vetLicenseNumber: "MD-777" })]);
    renderSection();

    const license = await screen.findByTestId("vet-license-u-5");
    expect(license.textContent).toContain("MD-777");
  });

  it("approval promotes the user to their requested role (C3)", async () => {
    listPendingMock.mockResolvedValue([pendingUser({ id: "u-3", vetLicenseNumber: "MD-42" })]);
    renderSection();

    fireEvent.click(await screen.findByTestId("btn-approve-user-u-3"));

    await waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith("u-3", "active", "vet"));
  });

  it("lets the admin override the granted role before approving (vet → tech)", async () => {
    listPendingMock.mockResolvedValue([pendingUser({ id: "u-4" })]);
    renderSection();

    fireEvent.change(await screen.findByTestId("grant-role-select-u-4"), {
      target: { value: "technician" },
    });
    fireEvent.click(screen.getByTestId("btn-approve-user-u-4"));

    await waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith("u-4", "active", "technician"));
  });
});
