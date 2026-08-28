/**
 * @vitest-environment happy-dom
 *
 * S13a (web half) — the restock inline edit discarded the measurement it
 * claimed to record. `commitInlineEdit` bailed out on `parsed === line.actual`,
 * so a technician who opened a row, counted it, and confirmed the number
 * already on hand sent NOTHING: the line stayed unscanned in the session, and
 * "I counted it and it matched" became indistinguishable from "I never counted
 * it". Only a count the server has ALREADY recorded for this session is a
 * genuine no-op (re-committing the same number must not re-post).
 *
 * This test drives the real page through the inline-edit path: tap the
 * quantity button, blur without changing the value, and assert the count is
 * committed — plus the mirror case, where a line already recorded at that same
 * count this session is correctly skipped.
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

/** `sessionObservedQuantity` is what the SERVER has already recorded this session. */
function view(sessionObservedQuantity: number | null): RestockContainerView {
  return {
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
        sessionObservedQuantity,
      },
    ],
  };
}

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

/** Open the row's inline editor and commit `value` from it. */
async function commitInlineCount(value: string) {
  const quantityButton = await screen.findByRole("button", { name: "Set quantity for Saline" });
  fireEvent.click(quantityButton);

  const input = await screen.findByRole("spinbutton");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("InventoryPage — a confirmed-equal restock count is a measurement (S13a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([CONTAINER]);
    startMock.mockResolvedValue({
      id: "session-1",
      clinicId: "clinic-1",
      containerId: "c1",
      ownedByUserId: "u1",
      status: "active",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
    });
    scanMock.mockResolvedValue({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 4,
    });
  });

  it("commits a count confirmed equal to the held stock when nothing was recorded this session", async () => {
    containerItemsMock.mockResolvedValue(view(null));
    renderPage();

    await commitInlineCount("4");

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(scanMock).toHaveBeenCalledWith("session-1", {
      itemId: "i1",
      nfcTagId: undefined,
      observedQuantity: 4,
    });
  });

  it("skips re-committing a count the server already recorded for this session", async () => {
    containerItemsMock.mockResolvedValue(view(4));
    renderPage();

    await commitInlineCount("4");

    // Give the (absent) commit a chance to fire before asserting it did not.
    await waitFor(() => expect(screen.queryByRole("spinbutton")).toBeNull());
    expect(scanMock).not.toHaveBeenCalled();
  });
});
