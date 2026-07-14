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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Equipment } from "@/types";

const returnMock = vi.fn();
const checkoutMock = vi.fn();
const listDocksMock = vi.fn();
const listConditionsMock = vi.fn();
const conditionStatesMock = vi.fn();
const dockReturnMock = vi.fn();
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
    vi.clearAllMocks();
    authValue = { userId: "admin-1", isAdmin: true };
    shiftValue = { hasActiveShift: true, isLoading: false, isError: false, nextShift: null };
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
    authValue = { userId: "someone-else", isAdmin: false };
    renderActions(checkedOut);
    expect(screen.queryByTestId("btn-detail-checkin")).toBeNull();
  });

  it("shows Check in to the holder even when not admin", () => {
    authValue = { userId: "u2", isAdmin: false };
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
    vi.clearAllMocks();
    authValue = { userId: "admin-1", isAdmin: true };
    shiftValue = { hasActiveShift: true, isLoading: false, isError: false, nextShift: null };
    checkoutMock.mockResolvedValue({ equipment: { ...dockedAvailable, checkedOutById: "admin-1" } });
  });
  afterEach(() => cleanup());

  it("shows Checkout for a docked, available item while on shift", () => {
    renderActions(dockedAvailable);
    expect(screen.getByTestId("btn-detail-checkout")).toBeTruthy();
    expect(screen.queryByTestId("btn-detail-checkin")).toBeNull();
  });

  it("does not show Checkout for a returned item (that path is Dock Return)", () => {
    renderActions({ ...dockedAvailable, custodyState: "returned" });
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
    shiftValue = { hasActiveShift: false, isLoading: false, isError: false, nextShift: null };
    renderActions(dockedAvailable);
    fireEvent.click(screen.getByTestId("btn-detail-checkout"));
    expect(toastError).toHaveBeenCalled();
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  // Fail-loud (not fail-closed): a *failed* shift read must NOT be read as
  // "off-shift". `hasActiveShift` is false while the query errors, but the
  // client block keys on `!shiftError && !hasActiveShift` — so on a shift-query
  // error the client defers to the server's authoritative roster gate and still
  // fires the checkout. (Token-consistency asserts the source shape; this proves
  // the runtime behavior.)
  it("bypasses the client shift-block and still calls the API when the shift query errored", async () => {
    shiftValue = { hasActiveShift: false, isLoading: false, isError: true, nextShift: null };
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
});
