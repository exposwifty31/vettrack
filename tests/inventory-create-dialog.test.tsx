/**
 * @vitest-environment happy-dom
 *
 * T-28b — the inventory item create dialog must send isBillable +
 * minimumDispenseToCapture (R-IN-01 · client half of T-28a).
 *
 * The create/edit dialog in src/pages/inventory-items.tsx already renders the
 * "Track billing for this item" checkbox and the "Minimum qty to track"
 * input for BOTH create and edit (same form JSX, gated only on
 * `editTarget` for a couple of other fields) — but `createMut.mutationFn`
 * only forwarded code/label/category/nfcTagId/parLevel/reorderPoint, so a
 * value toggled in the create dialog was silently dropped on save. This test
 * drives the real dialog (not the API contract) and asserts the payload sent
 * to `api.inventoryItems.create` includes both fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { InventoryItem } from "@/types";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "user-admin", role: "admin" }),
}));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const listMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    inventoryItems: {
      list: (...a: unknown[]) => listMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      update: vi.fn(),
      delete: vi.fn(),
      lowStock: vi.fn(),
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

// Imported AFTER the mocks above so the component resolves the mocked modules.
import InventoryItemsPage from "@/pages/inventory-items";

const EXISTING_ITEM: InventoryItem = {
  id: "i1",
  clinicId: "clinic-1",
  code: "SALINE_500",
  label: "Saline 500ml",
  itemType: "CONSUMABLE",
  unit: "mL",
  nfcTagId: null,
  category: "Fluids",
  isBillable: true,
  minimumDispenseToCapture: 1,
  parLevel: 10,
  reorderPoint: 3,
  isActive: true,
  createdAt: "2026-07-01T00:00:00.000Z",
} as InventoryItem;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HelmetProvider>
        <Router hook={memoryLocation({ path: "/inventory-items" }).hook}>
          <InventoryItemsPage />
        </Router>
      </HelmetProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([EXISTING_ITEM]);
  createMock.mockResolvedValue({ ...EXISTING_ITEM, id: "new-1", code: "NEW_ITEM" });
});

afterEach(() => {
  cleanup();
});

describe("inventory items — create dialog sends isBillable + minimumDispenseToCapture (T-28b)", () => {
  it("submits both fields in the create payload", async () => {
    const p = t.inventoryItemsPage;
    renderPage();

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: p.newItem }));

    const codeField = screen.getByLabelText(p.fieldCode);
    const labelField = screen.getByLabelText(p.fieldLabel);
    fireEvent.change(codeField, { target: { value: "NEW_ITEM" } });
    fireEvent.change(labelField, { target: { value: "New Item" } });

    const billableCheckbox = screen.getByRole("checkbox", { name: p.fieldIsBillable });
    fireEvent.click(billableCheckbox); // isBillable: true -> false

    fireEvent.click(screen.getByRole("button", { name: p.save }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    const payload = createMock.mock.calls[0][0];
    expect(payload).toHaveProperty("isBillable", false);
    expect(payload).toHaveProperty("minimumDispenseToCapture");
  });

  it("keeps the dialog open with entered values retained and shows error feedback when the create call rejects", async () => {
    const p = t.inventoryItemsPage;
    createMock.mockRejectedValueOnce(new Error("network error"));
    renderPage();

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: p.newItem }));

    const codeField = screen.getByLabelText(p.fieldCode);
    const labelField = screen.getByLabelText(p.fieldLabel);
    fireEvent.change(codeField, { target: { value: "NEW_ITEM" } });
    fireEvent.change(labelField, { target: { value: "New Item" } });

    fireEvent.click(screen.getByRole("button", { name: p.save }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(p.itemCreateFailed));
    expect(toastSuccess).not.toHaveBeenCalled();

    // The dialog must stay open (no close-on-error) with the entered values
    // retained — the mutation's onError never calls setFormOpen(false).
    expect((screen.getByLabelText(p.fieldCode) as HTMLInputElement).value).toBe("NEW_ITEM");
    expect((screen.getByLabelText(p.fieldLabel) as HTMLInputElement).value).toBe("New Item");
    expect(screen.getByRole("button", { name: p.save })).toBeTruthy();
  });
});
