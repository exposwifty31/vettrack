/**
 * @vitest-environment happy-dom
 *
 * 7d Inventory console — read-only oversight across three lazy tabs (purchase orders,
 * restock sessions, low-stock). Covers the management.webWrite gating branch, the
 * default PO tab rendering, and switching tabs (plain buttons, so happy-dom drives
 * it) which lazily fetches that tab's data (B3 restock sessions, B4 low-stock).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const poMock = vi.fn();
const sessionsMock = vi.fn();
const lowStockMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    procurement: { list: (...a: unknown[]) => poMock(...a) },
    restock: { sessions: (...a: unknown[]) => sessionsMock(...a) },
    inventoryItems: { lowStock: (...a: unknown[]) => lowStockMock(...a) },
  },
}));

import InventoryConsolePage from "@/pages/console/InventoryConsolePage";

const POS = [{ id: "po1", clinicId: "c1", supplierName: "Acme Vet Supply", status: "ordered", orderedAt: null, expectedAt: null, notes: null, createdBy: "u1", createdAt: "2026-07-01T10:00:00.000Z", updatedAt: "2026-07-01T10:00:00.000Z" }];
const SESSIONS = [{ id: "s1", containerName: "Crash Cart A", status: "active", startedAt: "2026-07-01T09:00:00.000Z", finishedAt: null }];
const LOWSTOCK = [{ itemId: "i1", label: "Saline 500ml", parLevel: 20, onHand: 4, short: 16 }];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/inventory" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <InventoryConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  poMock.mockReset();
  sessionsMock.mockReset();
  lowStockMock.mockReset();
});
afterEach(() => cleanup());

describe("InventoryConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(poMock).not.toHaveBeenCalled();
  });

  it("renders the Purchase Orders tab by default", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    poMock.mockResolvedValue(POS);
    renderPage();
    expect(await screen.findByText("Acme Vet Supply")).toBeTruthy();
    // The other tabs have not fetched yet (lazy).
    expect(sessionsMock).not.toHaveBeenCalled();
    expect(lowStockMock).not.toHaveBeenCalled();
  });
});

describe("InventoryConsolePage — lazy tab switching", () => {
  beforeEach(() => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    poMock.mockResolvedValue(POS);
    sessionsMock.mockResolvedValue({ sessions: SESSIONS });
    lowStockMock.mockResolvedValue({ items: LOWSTOCK });
  });

  it("loads restock sessions (B3) when the Restock tab is selected", async () => {
    renderPage();
    await screen.findByText("Acme Vet Supply");
    fireEvent.click(screen.getByRole("tab", { name: t.console.inventory.tabRestock }));
    expect(await screen.findByText("Crash Cart A")).toBeTruthy();
    await waitFor(() => expect(sessionsMock).toHaveBeenCalledTimes(1));
  });

  it("loads low-stock items (B4) when the Low stock tab is selected", async () => {
    renderPage();
    await screen.findByText("Acme Vet Supply");
    fireEvent.click(screen.getByRole("tab", { name: t.console.inventory.tabLowStock }));
    expect(await screen.findByText("Saline 500ml")).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy(); // short = par 20 − onHand 4
  });
});
