/**
 * @vitest-environment happy-dom
 *
 * Docking P3 T3.4-i-b (Part B) — UsersSection Equipment Coordinator
 * eligibility toggle. Admin-only surface; the toggle calls
 * `api.users.setEquipmentCoordinator(userId, next)` and is only rendered for
 * technician-ranked users (technician / senior_technician) — not vet/admin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const listPaginatedMock = vi.fn();
const setEquipmentCoordinatorMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPaginated: (...a: unknown[]) => listPaginatedMock(...a),
      setEquipmentCoordinator: (...a: unknown[]) => setEquipmentCoordinatorMock(...a),
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
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { UsersSection } from "@/pages/admin/UsersSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersSection />
    </QueryClientProvider>,
  );
}

function makeUser(
  id: string,
  role: string,
  isEquipmentCoordinator: boolean | undefined = false,
) {
  return {
    id,
    clerkId: `clerk-${id}`,
    email: `${id}@clinic.example`,
    name: id,
    displayName: id,
    role,
    secondaryRole: null,
    isEquipmentCoordinator,
    status: "active",
    createdAt: "2026-07-10T10:00:00.000Z",
  };
}

beforeEach(() => {
  listPaginatedMock.mockReset();
  setEquipmentCoordinatorMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => cleanup());

describe("UsersSection — Equipment Coordinator eligibility toggle (T3.4-i-b Part B)", () => {
  it("shows the toggle for a technician and calls setEquipmentCoordinator on click", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-tech", "technician", false)],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    setEquipmentCoordinatorMock.mockResolvedValue(makeUser("u-tech", "technician", true));

    renderSection();

    const checkbox = (await screen.findByTestId(
      "checkbox-equipment-coordinator-u-tech",
    )) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(setEquipmentCoordinatorMock).toHaveBeenCalledWith("u-tech", true),
    );
  });

  it("shows the toggle for a senior_technician, pre-checked when already eligible", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-senior", "senior_technician", true)],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    // Clearing the flag resolves with the persisted (now-false) user shape.
    setEquipmentCoordinatorMock.mockResolvedValue(makeUser("u-senior", "senior_technician", false));

    renderSection();

    const checkbox = (await screen.findByTestId(
      "checkbox-equipment-coordinator-u-senior",
    )) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(setEquipmentCoordinatorMock).toHaveBeenCalledWith("u-senior", false),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(t.adminPage.equipmentCoordinatorUpdated));
  });

  it("surfaces the error toast and leaves the checkbox unchanged when setEquipmentCoordinator rejects", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-tech", "technician", false)],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    setEquipmentCoordinatorMock.mockRejectedValueOnce(new Error("network down"));

    renderSection();

    const checkbox = (await screen.findByTestId(
      "checkbox-equipment-coordinator-u-tech",
    )) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t.adminPage.equipmentCoordinatorUpdateFailed),
    );
    // No optimistic update → the mutation failing leaves the query-derived
    // checkbox at its original (unchecked) state; nothing to roll back.
    expect(
      (screen.getByTestId("checkbox-equipment-coordinator-u-tech") as HTMLInputElement).checked,
    ).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does NOT render the toggle for a vet or admin user", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-vet", "vet", false), makeUser("u-admin", "admin", false)],
      total: 2,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });

    renderSection();

    await screen.findByTestId("user-row-u-vet");
    expect(screen.queryByTestId("checkbox-equipment-coordinator-u-vet")).toBeNull();
    expect(screen.queryByTestId("checkbox-equipment-coordinator-u-admin")).toBeNull();
  });
});
