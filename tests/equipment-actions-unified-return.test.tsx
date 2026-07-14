/**
 * @vitest-environment happy-dom
 *
 * T2.3-mobile (docking P2) — the native mobile detail's "Check in" (return)
 * action mounts `UnifiedReturnDialog` (home-station toggle) instead of the
 * plain `ReturnPlugDialog`. Mirrors the harness in tests/equipment-actions.test.tsx
 * but additionally mocks `api.operationalState` (docks/conditions/dock-return)
 * since UnifiedReturnDialog queries it unconditionally on mount.
 *
 * CRITICAL invariant under test: the unchecked (no home-station) path MUST
 * still go through `EquipmentActions`' own `returnMut` → `api.equipment.return`
 * — the offline-capable path (`pendingSyncId` / savedOffline toast) — not some
 * internal plain-return the dialog might otherwise own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Dock, Equipment } from "@/types";

const returnMock = vi.fn();
const checkoutMock = vi.fn();
const listDocksMock = vi.fn();
const listConditionsMock = vi.fn();
const conditionStatesMock = vi.fn();
const dockReturnMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
let authValue: { userId: string | null; isAdmin: boolean } = { userId: "admin-1", isAdmin: true };
let shiftValue: { hasActiveShift: boolean; isLoading: boolean; isError: boolean; nextShift: null } = {
  hasActiveShift: true,
  isLoading: false,
  isError: false,
  nextShift: null,
};

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
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
    },
    ApiError: class ApiError extends Error {},
  };
});

import { EquipmentActions } from "@/features/equipment/detail/EquipmentActions";

const HOME_DOCK: Dock = {
  id: "dock-1",
  clinicId: "clinic-1",
  name: "ICU Charging Station",
  roomId: "room-1",
  assetTypeId: "asset-pump",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderActions(equipment: Partial<Equipment>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentActions equipment={equipment as Equipment} />
    </QueryClientProvider>,
  );
}

const checkedOutNoHome: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: "u2",
  homeRoomId: null,
  assetTypeId: null,
};
const checkedOutWithHome: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: "u2",
  homeRoomId: "room-1",
  assetTypeId: "asset-pump",
};
const dockedAvailable: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: null,
  custodyState: "docked",
  status: "ok",
};

describe("EquipmentActions — T2.3-mobile UnifiedReturnDialog", () => {
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
  });
  afterEach(() => cleanup());

  it("(a) Check-in opens the UnifiedReturnDialog (home-station toggle UI), not the plain dialog", async () => {
    renderActions(checkedOutWithHome);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));
    expect(await screen.findByTestId("toggle-return-to-station")).toBeTruthy();
  });

  it("(b) toggle CHECKED + submit calls the dock-return endpoint, not api.equipment.return", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);
    renderActions(checkedOutWithHome);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));

    await screen.findByText("ICU Charging Station", { exact: false });
    const toggle = screen.getByTestId("toggle-return-to-station") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));
    expect(dockReturnMock).toHaveBeenCalledWith(
      "eq-1",
      expect.objectContaining({ dockId: "dock-1" }),
    );
    expect(returnMock).not.toHaveBeenCalled();
  });

  it("(c) toggle UNCHECKED + submit calls the OFFLINE-capable plain return (api.equipment.return via returnMut)", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);
    renderActions(checkedOutWithHome);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));

    await screen.findByText("ICU Charging Station", { exact: false });
    fireEvent.click(screen.getByTestId("toggle-return-to-station")); // uncheck

    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    expect(returnMock).toHaveBeenCalledWith("eq-1", expect.objectContaining({ isPluggedIn: true }));
    expect(dockReturnMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("(c') preserves the offline savedOffline toast when returnMut resolves with a pendingSyncId", async () => {
    returnMock.mockResolvedValue({ equipment: { ...dockedAvailable }, pendingSyncId: "sync-123" });
    renderActions(checkedOutNoHome); // no home room → toggle disabled, plain path is the only path
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));

    await screen.findByTestId("unified-return-no-home-hint");
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(t.equipmentDetail.toast.savedOffline),
    );
  });

  it("(d) Check out (Take) still works unchanged — checkoutMut, not the return dialog", async () => {
    renderActions(dockedAvailable);
    expect(screen.queryByTestId("toggle-return-to-station")).toBeNull();
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith("eq-1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(returnMock).not.toHaveBeenCalled();
    expect(dockReturnMock).not.toHaveBeenCalled();
  });
});
