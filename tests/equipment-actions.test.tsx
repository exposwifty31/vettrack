/**
 * @vitest-environment happy-dom
 *
 * Stage 6 increment 3 — behavioral verification of the mobile detail "Check in"
 * (return) action. Drives the real wrapper: gating → UnifiedReturnDialog
 * (unchecked/no-home-station path, T2.3-mobile) → api.equipment.return.
 * (The mobile screen can't be driven in plain Chrome — it needs the native
 * shell — so this jsdom test IS the behavior check.) See
 * tests/equipment-actions-unified-return.test.tsx for the dock-return
 * (checked-toggle) path and the offline pendingSyncId preservation check.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";
import {
  authState,
  checkoutMock,
  DEFAULT_AUTH_VALUE,
  dockReturnMock,
  conditionStatesMock,
  listConditionsMock,
  listDocksMock,
  resetEquipmentActionsMocks,
  returnMock,
  shiftState,
  toastError,
  toastSuccess,
} from "./helpers/equipment-actions-mocks";

import { EquipmentActions } from "@/features/equipment/detail/EquipmentActions";

function renderActions(equipment: Partial<Equipment>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentActions equipment={equipment as Equipment} />
    </QueryClientProvider>,
  );
}

const checkedOut: Partial<Equipment> = { id: "eq-1", name: "Infusion Pump", checkedOutById: "u2" };
const available: Partial<Equipment> = { id: "eq-1", name: "Infusion Pump", checkedOutById: null };
const dockedAvailable: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  checkedOutById: null,
  custodyState: "docked",
  status: "ok",
};

describe("EquipmentActions — Stage 6 check-in", () => {
  beforeEach(() => {
    resetEquipmentActionsMocks();
    returnMock.mockResolvedValue({ equipment: { ...available }, undoToken: undefined });
    checkoutMock.mockResolvedValue({ equipment: { ...dockedAvailable, checkedOutById: "admin-1" } });
    listDocksMock.mockResolvedValue([]);
    listConditionsMock.mockResolvedValue([]);
    conditionStatesMock.mockResolvedValue([]);
    dockReturnMock.mockResolvedValue({ equipmentId: "eq-1", readinessState: "ready", custodyState: "docked" });
  });
  afterEach(() => cleanup());

  it("shows Check in when checked out and the viewer is an admin", () => {
    renderActions(checkedOut);
    expect(screen.getByTestId("btn-detail-checkin")).toBeTruthy();
  });

  it("renders nothing when the item is not checked out", () => {
    renderActions(available);
    expect(screen.queryByTestId("btn-detail-checkin")).toBeNull();
  });

  it("renders nothing for a non-admin who is not the holder", () => {
    authState.value = { userId: "someone-else", isAdmin: false };
    renderActions(checkedOut);
    expect(screen.queryByTestId("btn-detail-checkin")).toBeNull();
  });

  it("shows Check in to the holder even when not admin", () => {
    authState.value = { userId: "u2", isAdmin: false };
    renderActions(checkedOut);
    expect(screen.getByTestId("btn-detail-checkin")).toBeTruthy();
  });

  it("opens the return dialog and calls api.equipment.return on confirm", async () => {
    renderActions(checkedOut);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));
    const confirm = await screen.findByTestId("btn-confirm-return-plug");
    fireEvent.click(confirm);
    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    expect(returnMock).toHaveBeenCalledWith("eq-1", expect.objectContaining({ isPluggedIn: true }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("surfaces an error toast (and no success) when the return mutation rejects", async () => {
    returnMock.mockRejectedValueOnce(new Error("network down"));
    renderActions(checkedOut);
    fireEvent.click(screen.getByTestId("btn-detail-checkin"));
    const confirm = await screen.findByTestId("btn-confirm-return-plug");
    fireEvent.click(confirm);
    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

/**
 * Detail checkout (device sweep 2026-07-14, owner request) — the mobile detail
 * shipped Return-only, so a tech who browsed to an available item's record had
 * no way to take it (search → detail → take was a dead end). Add a Checkout
 * action mirroring the equipment-list quick-action gate: available (`docked`,
 * status ok, not `returned`, not held) + on an active roster shift.
 */
describe("EquipmentActions — detail checkout", () => {
  beforeEach(() => {
    resetEquipmentActionsMocks();
    checkoutMock.mockResolvedValue({ equipment: { ...dockedAvailable, checkedOutById: "admin-1" } });
  });
  afterEach(() => cleanup());

  it("shows Checkout for a docked, available item while on shift", () => {
    renderActions(dockedAvailable);
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
    expect(screen.queryByTestId("btn-detail-checkin")).toBeNull();
  });

  it("does not show Checkout for a returned item WITH a home dock (that path is Dock Return)", () => {
    renderActions({ ...dockedAvailable, custodyState: "returned", homeRoomId: "room-1" });
    expect(screen.queryByTestId("btn-detail-checkout")).toBeNull();
  });

  it("does not show Checkout for an item with an issue status", () => {
    renderActions({ ...dockedAvailable, status: "issue" });
    expect(screen.queryByTestId("btn-detail-checkout")).toBeNull();
  });

  it("checks out and shows a success toast when on shift", async () => {
    renderActions(dockedAvailable);
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith("eq-1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("blocks checkout off-shift with an error toast and never calls the API", () => {
    // A non-exempt role (default authState is admin, which now carries
    // equipment.actOffShift — see the dedicated exemption test below).
    authState.value = {
      ...DEFAULT_AUTH_VALUE,
      userId: "tech-1",
      isAdmin: false,
      role: "technician",
      effectiveRole: "technician",
    };
    shiftState.value = { hasActiveShift: false, isLoading: false, isError: false, nextShift: null };
    renderActions(dockedAvailable);
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    expect(toastError).toHaveBeenCalled();
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("admin off-shift checkout is exempt via equipment.actOffShift — no block, API fires", async () => {
    shiftState.value = { hasActiveShift: false, isLoading: false, isError: false, nextShift: null };
    renderActions(dockedAvailable);
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith("eq-1"));
    expect(toastError).not.toHaveBeenCalled();
  });

  // Fail-loud (not fail-closed): a *failed* shift read must NOT be read as
  // "off-shift". `hasActiveShift` is false while the query errors, but the
  // client block keys on `!shiftError && !hasActiveShift` — so on a shift-query
  // error the client defers to the server's authoritative roster gate and still
  // fires the checkout. (Token-consistency asserts the source shape; this proves
  // the runtime behavior.)
  it("bypasses the client shift-block and still calls the API when the shift query errored", async () => {
    shiftState.value = { hasActiveShift: false, isLoading: false, isError: true, nextShift: null };
    renderActions(dockedAvailable);
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith("eq-1"));
    expect(toastError).not.toHaveBeenCalled();
  });

  // The gate is availability (`!isCheckedOut && status ok && not returned`), NOT
  // "confirmed docked". `custody_state` defaults to "untracked" server-side
  // (server/schema/equipment.ts) and the equipment-list quick action offers
  // Checkout for the same non-returned/available set — so an untracked or
  // custody-null available item must still show Checkout, or the search →
  // detail → take dead-end this feature closes would reopen for the default
  // custody state.
  it("shows Checkout for an untracked available item (mirrors the list gate; docked is not required)", () => {
    renderActions({ ...dockedAvailable, custodyState: "untracked" });
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
  });

  it("shows Checkout for an available item with no custody state (custodyState null)", () => {
    renderActions({ ...dockedAvailable, custodyState: null });
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
  });

  it("shows Checkout for a returned item with no home dock (C5)", () => {
    renderActions({
      ...dockedAvailable,
      checkedOutById: null,
      status: "ok",
      custodyState: "returned",
      homeRoomId: null,
    });
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
  });

  it("hides Checkout for a returned item WITH a home dock (route through Dock Return)", () => {
    renderActions({
      ...dockedAvailable,
      checkedOutById: null,
      status: "ok",
      custodyState: "returned",
      homeRoomId: "room-1",
    });
    expect(screen.queryByTestId("btn-detail-checkout")).toBeNull();
  });

  it("shows Checkout for a docked item with a home dock (unchanged behavior)", () => {
    renderActions({
      ...dockedAvailable,
      checkedOutById: null,
      status: "ok",
      custodyState: "docked",
      homeRoomId: "room-1",
    });
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
  });

  it("vet off-shift checkout of a returned/no-dock item fires — not blocked by the shift gate", async () => {
    authState.value = {
      ...DEFAULT_AUTH_VALUE,
      userId: "vet-1",
      isAdmin: false,
      role: "vet",
      effectiveRole: "vet",
    };
    shiftState.value = { hasActiveShift: false, isLoading: false, isError: false, nextShift: null };
    renderActions({
      ...dockedAvailable,
      checkedOutById: null,
      status: "ok",
      custodyState: "returned",
      homeRoomId: null,
    });
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith("eq-1"));
    expect(toastError).not.toHaveBeenCalledWith(t.scan.offShiftBody);
  });
});
