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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Dock, Equipment } from "@/types";
import {
  checkoutMock,
  conditionStatesMock,
  dockReturnMock,
  listConditionsMock,
  listDocksMock,
  resetEquipmentActionsMocks,
  returnMock,
  toastError,
  toastSuccess,
} from "./helpers/equipment-actions-mocks";

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
    resetEquipmentActionsMocks();
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

  it("#21 (P2 review) — dockReturn failure surfaces the error toast, not a silent close/success", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);
    dockReturnMock.mockRejectedValueOnce(new Error("dock unreachable"));
    renderActions(checkedOutWithHome);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));

    await screen.findByText("ICU Charging Station", { exact: false });
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("dock unreachable"));
    expect(toastSuccess).not.toHaveBeenCalled();
    // Dialog stays open on failure — not silently closed/succeeded.
    expect(screen.getByTestId("toggle-return-to-station")).toBeTruthy();
  });

  it("#21 (P2 review) — plain return failure (unchecked path) surfaces the error toast, not a silent close/success", async () => {
    returnMock.mockRejectedValueOnce(new Error("server unavailable"));
    renderActions(checkedOutNoHome);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));

    await screen.findByTestId("unified-return-no-home-hint");
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    // Dialog stays open on failure — not silently closed/succeeded.
    expect(screen.getByTestId("btn-confirm-return-plug")).toBeTruthy();
  });
});
