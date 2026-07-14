/**
 * @vitest-environment happy-dom
 *
 * T2.5-mobile (docking P2) — the mobile detail actions gain a "Not Found
 * Here" secondary action that fires `api.docking.notFoundHere`. This is a
 * negative report by a seeker who went looking and the item is absent —
 * reached via search → detail (no scan possible for a missing item).
 *
 * Gated on `!isCheckedOut && !!equipment.homeRoomId` — hidden when someone
 * holds the item (accounted for) and hidden for non-docking clinics (no
 * home station to report against).
 *
 * Mirrors the harness in tests/equipment-actions-unified-return.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

const returnMock = vi.fn();
const checkoutMock = vi.fn();
const listDocksMock = vi.fn();
const listConditionsMock = vi.fn();
const conditionStatesMock = vi.fn();
const dockReturnMock = vi.fn();
const notFoundHereMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let authValue: { userId: string | null; isAdmin: boolean } = { userId: "admin-1", isAdmin: true };
let shiftValue: { hasActiveShift: boolean; isLoading: boolean; isError: boolean; nextShift: null } = {
  hasActiveShift: true,
  isLoading: false,
  isError: false,
  nextShift: null,
};

vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authValue }));
vi.mock("@/hooks/use-active-shift", () => ({ useActiveShift: () => shiftValue }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        return: (...a: unknown[]) => returnMock(...a),
        checkout: (...a: unknown[]) => checkoutMock(...a),
      },
      operationalState: {
        ...actual.api.operationalState,
        listDocks: (...a: unknown[]) => listDocksMock(...a),
        listConditions: (...a: unknown[]) => listConditionsMock(...a),
        conditionStates: (...a: unknown[]) => conditionStatesMock(...a),
        dockReturn: (...a: unknown[]) => dockReturnMock(...a),
      },
      docking: {
        ...actual.api.docking,
        notFoundHere: (...a: unknown[]) => notFoundHereMock(...a),
      },
    },
    ApiError: class ApiError extends Error {},
  };
});

import { EquipmentActions } from "@/features/equipment/detail/EquipmentActions";

function renderActions(equipment: Partial<Equipment>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentActions equipment={equipment as Equipment} />
    </QueryClientProvider>,
  );
}

const restingHomed: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: null,
  homeRoomId: "room-1",
  status: "issue", // deliberately not checkout-eligible — isolates the not-found gate from canCheckout
};
const checkedOutByMeHomed: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: "admin-1",
  homeRoomId: "room-1",
};
const restingNoHome: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: null,
  homeRoomId: null,
  status: "issue",
};
const dockedAvailable: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: null,
  custodyState: "docked",
  status: "ok",
};

describe("EquipmentActions — Not Found Here (T2.5-mobile)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authValue = { userId: "admin-1", isAdmin: true };
    shiftValue = { hasActiveShift: true, isLoading: false, isError: false, nextShift: null };
    returnMock.mockResolvedValue({ equipment: { ...dockedAvailable }, undoToken: undefined });
    checkoutMock.mockResolvedValue({ equipment: { ...dockedAvailable, checkedOutById: "admin-1" } });
    listDocksMock.mockResolvedValue([]);
    listConditionsMock.mockResolvedValue([]);
    conditionStatesMock.mockResolvedValue([]);
    dockReturnMock.mockResolvedValue({ equipmentId: "eq-1", readinessState: "ready", custodyState: "docked" });
    notFoundHereMock.mockResolvedValue({ ok: true });
  });
  afterEach(() => cleanup());

  it("(a) resting + homed + not-held: shows the button and clicking it calls api.docking.notFoundHere(id)", async () => {
    renderActions(restingHomed);
    const btn = screen.getByTestId("btn-detail-not-found-here");
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    await waitFor(() => expect(notFoundHereMock).toHaveBeenCalledWith("eq-1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("(b) checked-out-by-me: button is absent", () => {
    renderActions(checkedOutByMeHomed);
    expect(screen.queryByTestId("btn-detail-not-found-here")).toBeNull();
  });

  it("(c) resting + no homeRoomId: button is absent", () => {
    renderActions(restingNoHome);
    expect(screen.queryByTestId("btn-detail-not-found-here")).toBeNull();
  });

  it("(d) existing Check out still renders/behaves — Not Found Here does not steal the gate", async () => {
    renderActions(dockedAvailable);
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
    // dockedAvailable has no homeRoomId in this fixture — Not Found Here stays hidden
    expect(screen.queryByTestId("btn-detail-not-found-here")).toBeNull();
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith("eq-1"));
  });

  it("(e) both Checkout and Not Found Here can render together for a homed, available item", () => {
    renderActions({ ...dockedAvailable, homeRoomId: "room-1" });
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
    expect(screen.getByTestId("btn-detail-not-found-here")).toBeTruthy();
  });

  it("surfaces an error toast when the mutation rejects", async () => {
    notFoundHereMock.mockRejectedValueOnce(new Error("network down"));
    renderActions(restingHomed);
    fireEvent.click(screen.getByTestId("btn-detail-not-found-here"));
    await waitFor(() => expect(notFoundHereMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("M-4 (P2 review) — error toast uses the dedicated notFoundFailed copy, not returnFailed", async () => {
    notFoundHereMock.mockRejectedValueOnce(new Error("network down"));
    renderActions(restingHomed);
    fireEvent.click(screen.getByTestId("btn-detail-not-found-here"));
    await waitFor(() => expect(notFoundHereMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t.equipmentDetail.toast.notFoundFailed));
  });
});
