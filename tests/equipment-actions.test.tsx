/**
 * @vitest-environment happy-dom
 *
 * Stage 6 increment 3 — behavioral verification of the mobile detail "Check in"
 * (return) action. Drives the real wrapper: gating → ReturnPlugDialog →
 * api.equipment.return. (The mobile screen can't be driven in plain Chrome —
 * it needs the native shell — so this jsdom test IS the behavior check.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Equipment } from "@/types";

const returnMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let authValue: { userId: string | null; isAdmin: boolean } = { userId: "admin-1", isAdmin: true };

vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authValue }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { equipment: { return: (...a: unknown[]) => returnMock(...a) } } }));

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

describe("EquipmentActions — Stage 6 check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authValue = { userId: "admin-1", isAdmin: true };
    returnMock.mockResolvedValue({ equipment: { ...available }, undoToken: undefined });
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
});
