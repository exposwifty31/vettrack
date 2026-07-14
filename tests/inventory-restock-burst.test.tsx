/**
 * @vitest-environment happy-dom
 *
 * T-29 (R-IN-02 · CLICK-PATH-019 · Tier S) — the restock +/- controls on
 * /inventory sent an ABSOLUTE quantity per tap with no per-row disable. A
 * fast burst of taps on the same row raced: each tap computed its next
 * value from a stale base (the previous tap's `scanLine` mutation hadn't
 * settled), desyncing the persisted quantity from what the user saw.
 *
 * This test drives the real page: it taps Increment on row 1 while that
 * row's scan call is still pending (the mocked `scan()` never resolves),
 * then asserts row 1's +/- controls are disabled — so a burst tap can't
 * race — while row 2's +/- controls (a different row, nothing pending for
 * it) stay interactive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";
import type { InventoryContainer, RestockContainerView } from "@/types";

afterEach(() => cleanup());

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    userId: "u1",
    role: "technician",
    effectiveRole: "technician",
    roleSource: "permanent",
    isAdmin: false,
  }),
}));

vi.mock("@/lib/haptics", () => ({
  haptics: {
    tap: vi.fn(),
    error: vi.fn(),
    scanSuccess: vi.fn(),
    itemAdded: vi.fn(),
  },
}));

const listMock = vi.fn();
const bootstrapMock = vi.fn();
const containerItemsMock = vi.fn();
const startMock = vi.fn();
const scanMock = vi.fn();
const finishMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      containers: {
        ...actual.api.containers,
        list: (...a: unknown[]) => listMock(...a),
        bootstrapDefaults: (...a: unknown[]) => bootstrapMock(...a),
      },
      restock: {
        ...actual.api.restock,
        containerItems: (...a: unknown[]) => containerItemsMock(...a),
        start: (...a: unknown[]) => startMock(...a),
        scan: (...a: unknown[]) => scanMock(...a),
        finish: (...a: unknown[]) => finishMock(...a),
      },
    },
  };
});

// Imported AFTER the mocks above so the component resolves the mocked modules.
import InventoryPage from "@/pages/inventory-page";

const CONTAINER: InventoryContainer = {
  id: "c1",
  clinicId: "clinic-1",
  name: "ICU Cart",
  department: "hospital",
  targetQuantity: 20,
  currentQuantity: 8,
  roomId: null,
  billingItemId: null,
  nfcTagId: null,
};

const CONTAINER_VIEW: RestockContainerView = {
  container: CONTAINER,
  activeSession: null,
  lines: [
    {
      itemId: "i1",
      code: "SKU1",
      label: "Saline",
      nfcTagId: null,
      expected: 10,
      actual: 4,
      missing: 6,
      sessionObservedQuantity: null,
    },
    {
      itemId: "i2",
      code: "SKU2",
      label: "Gauze",
      nfcTagId: null,
      expected: 10,
      actual: 4,
      missing: 6,
      sessionObservedQuantity: null,
    },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/inventory" });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <InventoryPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("InventoryPage — restock +/- controls serialize per row (T-29)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([CONTAINER]);
    containerItemsMock.mockResolvedValue(CONTAINER_VIEW);
    startMock.mockResolvedValue({
      id: "session-1",
      clinicId: "clinic-1",
      containerId: "c1",
      ownedByUserId: "u1",
      status: "active",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
    });
    // Never resolves within the test — keeps the scan mutation pending so we
    // can assert the mid-flight disabled scoping.
    scanMock.mockImplementation(() => new Promise(() => {}));
  });

  it("disables row 1's +/- while its scanLine mutation is pending, but row 2's +/- stay interactive", async () => {
    renderPage();

    const incRow1 = await screen.findByRole("button", { name: "Increment Saline" });
    const decRow1 = screen.getByRole("button", { name: "Decrement Saline" });
    const incRow2 = screen.getByRole("button", { name: "Increment Gauze" });
    const decRow2 = screen.getByRole("button", { name: "Decrement Gauze" });

    fireEvent.click(incRow1);

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect((incRow1 as HTMLButtonElement).disabled).toBe(true);
      expect((decRow1 as HTMLButtonElement).disabled).toBe(true);
    });

    // A different row's mutation isn't pending — it must stay interactive.
    expect((incRow2 as HTMLButtonElement).disabled).toBe(false);
    expect((decRow2 as HTMLButtonElement).disabled).toBe(false);
  });
});
