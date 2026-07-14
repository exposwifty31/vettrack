/**
 * @vitest-environment happy-dom
 *
 * T17 (audit MEDIUM) — the dispense cart/sheet stock indicator read
 * "20/20 · מלא · 100%" both before AND after dispensing 1 unit. Root cause:
 * `DispenseSheet.applyDispenseSuccess` only invalidated the
 * `["/api/containers/detail", containerId]` query key it fetches with —
 * the container-detail card on `inventory-page.tsx` (per-line "actual/expected"
 * quantity, the "מלא" stocked badge, and the overall fill %) reads the SAME
 * underlying data through a *different* cache key,
 * `["/api/restock/container-items", containerId]` (see
 * `src/pages/inventory-page.tsx` `detailsQ` and the NFC-scan invalidation in
 * `src/components/layout.tsx`). Server-side stock genuinely decrements
 * (`server/services/dispense.service.ts`), but the parent page's cached view
 * never refetched, so the indicator stayed frozen at "20/20 · 100%".
 *
 * This test drives a real dispense through `DispenseSheet` and asserts the
 * restock-view query key is invalidated — the exact cache the container
 * detail card reads. It fails against the pre-fix code (only the
 * containers/detail key was invalidated).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const containerDispenseWithResultMock = vi.fn();
const containerItemsMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    containerDispenseWithResult: (...args: unknown[]) => containerDispenseWithResultMock(...args),
    api: {
      ...actual.api,
      restock: {
        ...actual.api.restock,
        containerItems: (...args: unknown[]) => containerItemsMock(...args),
      },
    },
  };
});

import { DispenseSheet } from "@/features/containers/components/DispenseSheet";

const CONTAINER_ID = "container-1";

function containerItemsView(actual: number, expected: number) {
  return {
    container: {
      id: CONTAINER_ID,
      clinicId: "clinic-1",
      name: "ER Supply Cart",
      department: "ER",
      targetQuantity: expected,
      currentQuantity: actual,
      roomId: null,
      billingItemId: null,
      nfcTagId: null,
    },
    lines: [
      {
        itemId: "item-1",
        code: "DX",
        label: "Drug X",
        nfcTagId: null,
        expected,
        actual,
        missing: 0,
        sessionObservedQuantity: null,
      },
    ],
    activeSession: null,
  };
}

function renderSheet(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DispenseSheet containerId={CONTAINER_ID} isOpen={true} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

async function selectOneAndDispense() {
  const incrementBtn = await screen.findByRole("button", { name: t.dispense.sheet.increase });
  fireEvent.click(incrementBtn);

  const continueBtn = screen.getByRole("button", { name: t.dispense.sheet.continue });
  fireEvent.click(continueBtn);

  const noPatientBtn = await screen.findByRole("button", { name: t.dispense.sheet.noPatientAssignment });
  fireEvent.click(noPatientBtn);

  const confirmBtn = screen.getByRole("button", { name: t.dispense.sheet.confirmTake });
  fireEvent.click(confirmBtn);
}

describe("DispenseSheet — stock indicator cache refresh (T17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    containerItemsMock.mockResolvedValue(containerItemsView(20, 20));
    containerDispenseWithResultMock.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        takenBy: { userId: "u-1", displayName: "Tech One" },
        takenAt: "2026-07-11T10:00:00Z",
        dispensed: [{ itemId: "item-1", label: "Drug X", quantity: 1, newStock: 19 }],
      },
    });
  });
  afterEach(() => cleanup());

  it("invalidates the restock container-items view (the container detail card's cache key) after a successful dispense", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderSheet(client);
    await selectOneAndDispense();

    await waitFor(() => expect(containerDispenseWithResultMock).toHaveBeenCalledTimes(1));

    // Non-vacuous: pre-fix, DispenseSheet only invalidated
    // ["/api/containers/detail", containerId] — the container detail card on
    // inventory-page.tsx reads ["/api/restock/container-items", containerId]
    // and would stay frozen at "20/20 · מלא · 100%" without this call.
    await waitFor(() => {
      const calledWithRestockKey = invalidateSpy.mock.calls.some(
        (call) =>
          JSON.stringify((call[0] as { queryKey?: unknown[] })?.queryKey) ===
          JSON.stringify(["/api/restock/container-items", CONTAINER_ID]),
      );
      expect(calledWithRestockKey).toBe(true);
    });
  });

  it("also invalidates the containers/detail key DispenseSheet itself reads (unchanged prior behavior)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderSheet(client);
    await selectOneAndDispense();

    await waitFor(() => expect(containerDispenseWithResultMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const calledWithDetailKey = invalidateSpy.mock.calls.some(
        (call) =>
          JSON.stringify((call[0] as { queryKey?: unknown[] })?.queryKey) ===
          JSON.stringify(["/api/containers/detail", CONTAINER_ID]),
      );
      expect(calledWithDetailKey).toBe(true);
    });
  });
});
