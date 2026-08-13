/**
 * @vitest-environment happy-dom
 *
 * Doctor shift gate (spec 2026-08-13) — UsersSection senior-doctor eligibility
 * checkbox. Admin-only surface; the toggle calls
 * `api.users.setSeniorDoctorEligible(userId, next)` and is only rendered for
 * vet-role users — not technician/admin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const listPaginatedMock = vi.fn();
const setSeniorDoctorEligibleMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPaginated: (...a: unknown[]) => listPaginatedMock(...a),
      setSeniorDoctorEligible: (...a: unknown[]) => setSeniorDoctorEligibleMock(...a),
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
  seniorDoctorEligible: boolean | undefined = false,
) {
  return {
    id,
    clerkId: `clerk-${id}`,
    email: `${id}@clinic.example`,
    name: id,
    displayName: id,
    role,
    secondaryRole: null,
    isEquipmentCoordinator: false,
    seniorDoctorEligible,
    status: "active",
    createdAt: "2026-08-10T10:00:00.000Z",
  };
}

beforeEach(() => {
  listPaginatedMock.mockReset();
  setSeniorDoctorEligibleMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => cleanup());

describe("UsersSection — senior-doctor eligibility checkbox (doctor shift gate)", () => {
  it("shows the checkbox for a vet and calls setSeniorDoctorEligible(id, true) on click", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-vet", "vet", false)],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    setSeniorDoctorEligibleMock.mockResolvedValue(makeUser("u-vet", "vet", true));

    renderSection();

    const checkbox = (await screen.findByTestId(
      "checkbox-senior-doctor-eligible-u-vet",
    )) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(setSeniorDoctorEligibleMock).toHaveBeenCalledWith("u-vet", true),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(t.adminPage.seniorDoctorEligibleUpdated),
    );
  });

  it("renders pre-checked for an already-eligible vet and clears the flag on click", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-senior-vet", "vet", true)],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    setSeniorDoctorEligibleMock.mockResolvedValue(makeUser("u-senior-vet", "vet", false));

    renderSection();

    const checkbox = (await screen.findByTestId(
      "checkbox-senior-doctor-eligible-u-senior-vet",
    )) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(setSeniorDoctorEligibleMock).toHaveBeenCalledWith("u-senior-vet", false),
    );
  });

  it("surfaces the error toast and leaves the checkbox unchanged when the call rejects", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-vet", "vet", false)],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    setSeniorDoctorEligibleMock.mockRejectedValueOnce(new Error("network down"));

    renderSection();

    const checkbox = (await screen.findByTestId(
      "checkbox-senior-doctor-eligible-u-vet",
    )) as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t.adminPage.seniorDoctorEligibleUpdateFailed),
    );
    // No optimistic update → the failed mutation leaves the query-derived
    // checkbox at its original (unchecked) state.
    expect(
      (screen.getByTestId("checkbox-senior-doctor-eligible-u-vet") as HTMLInputElement).checked,
    ).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does NOT render the checkbox for technician, senior_technician, admin, or student users", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [
        makeUser("u-tech", "technician", false),
        makeUser("u-senior", "senior_technician", false),
        makeUser("u-admin", "admin", false),
        makeUser("u-student", "student", false),
      ],
      total: 4,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });

    renderSection();

    await screen.findByTestId("user-row-u-tech");
    expect(screen.queryByTestId("checkbox-senior-doctor-eligible-u-tech")).toBeNull();
    expect(screen.queryByTestId("checkbox-senior-doctor-eligible-u-senior")).toBeNull();
    expect(screen.queryByTestId("checkbox-senior-doctor-eligible-u-admin")).toBeNull();
    expect(screen.queryByTestId("checkbox-senior-doctor-eligible-u-student")).toBeNull();
  });
});
