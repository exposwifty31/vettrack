/**
 * @vitest-environment happy-dom
 *
 * S13b (web half) — the restock inline edit persisted a number the user never
 * typed. Two reference frames met in one write: the row RENDERED the optimistic
 * quantity (`optimisticActualByCode[code] ?? line.actual`), but the editor was
 * SEEDED from the raw cache value (`line.actual`) and committed a DELTA
 * (`parsed - line.actual`) that `scanLine` then applied on top of the optimistic
 * base. Whenever the two disagreed — which is exactly the window while a tap's
 * scan is still in flight, since the quantity button is not gated on pending
 * work — the absolute quantity POSTed was not the number on screen.
 *
 * Owner repro: held 4 → tap Increment (row shows 5, cache patch not landed yet)
 * → tap the quantity number → editor seeds "4" → commit "7" → delta 3 → 5 + 3
 * → persists 8.
 *
 * The fix makes the inline edit absolute end-to-end: seed from the same value
 * the row displays, and hand `scanLine` an absolute observed quantity rather
 * than a delta. This test drives the real page through that window.
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

/** Held stock is 4; nothing recorded for this session yet. */
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

function quantityButton() {
  return screen.getByRole("button", { name: "Set quantity for Saline" });
}

/** Open the row's inline editor and commit `value` from it. */
async function commitInlineCount(value: string) {
  fireEvent.click(quantityButton());
  const input = await screen.findByRole("spinbutton");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("InventoryPage — the restock inline edit persists the typed number (S13b)", () => {
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
  });

  it("posts the number the user typed while a prior scan is still in flight", async () => {
    // The +1 tap's scan hangs, so its cache patch (actual: 5) has NOT landed
    // while the inline edit is committed — the drift window.
    let resolveIncrement: ((value: unknown) => void) | undefined;
    scanMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveIncrement = resolve; }),
    );
    scanMock.mockResolvedValue({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 7,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Increment Saline" }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));

    // The row shows the optimistic 5 — that is the frame the user is reading.
    expect(quantityButton().textContent).toBe("5");

    await commitInlineCount("7");

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(2));
    expect(scanMock).toHaveBeenLastCalledWith("session-1", {
      itemId: "i1",
      nfcTagId: undefined,
      observedQuantity: 7,
    });

    // Ordering: the in-flight +1 resolves AFTER the absolute 7 was sent. The
    // last absolute write the client made must still be 7, and the row must
    // still read 7 — a late response cannot resurrect the superseded count.
    resolveIncrement?.({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 5,
    });

    await waitFor(() => expect(quantityButton().textContent).toBe("7"));
    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(scanMock).toHaveBeenLastCalledWith("session-1", {
      itemId: "i1",
      nfcTagId: undefined,
      observedQuantity: 7,
    });
  });

  /** Every observedQuantity this render actually sent, in order. */
  const postedQuantities = () =>
    scanMock.mock.calls.map((c) => (c[1] as { observedQuantity: number }).observedQuantity);

  it("refuses a fractional count instead of silently recording the truncation", async () => {
    // `parseInt("1.5", 10)` is 1, and 1 clears both of the old guards, so a
    // technician who typed 1.5 had 1 recorded against their name with nothing
    // on screen saying the number had changed.
    //
    // The assertion is the WHOLE call list, and that is not stylistic. A
    // `waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1))` passes here
    // even when the bug is present, because it catches the transient moment
    // after the rejected 1 posts and before the valid 6 does — the count is 1,
    // just from the wrong call. Measured: under `parseInt` this render sends
    // [1, 6]. Only the full ordered list can tell those apart.
    scanMock.mockResolvedValue({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 6,
    });

    renderPage();
    await screen.findByRole("button", { name: "Set quantity for Saline" });

    await commitInlineCount("1.5");
    await commitInlineCount("6");

    // The valid commit is the positive control: it must arrive, and when it
    // does it must be the ONLY thing that ever went out.
    await waitFor(() => expect(postedQuantities()).toContain(6));
    expect(postedQuantities()).toEqual([6]);
  });

  it("refuses an empty and a negative count the same way", async () => {
    scanMock.mockResolvedValue({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 6,
    });

    renderPage();
    await screen.findByRole("button", { name: "Set quantity for Saline" });

    await commitInlineCount("");
    await commitInlineCount("-2");
    await commitInlineCount("6");

    await waitFor(() => expect(postedQuantities()).toContain(6));
    expect(postedQuantities()).toEqual([6]);
  });

  it("still posts an unchanged commit — seeding from the displayed value is not a no-op (S13a)", async () => {
    scanMock.mockResolvedValue({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 4,
    });

    renderPage();
    await screen.findByRole("button", { name: "Set quantity for Saline" });

    // Open the editor and blur without touching the seeded value.
    fireEvent.click(quantityButton());
    fireEvent.blur(await screen.findByRole("spinbutton"));

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(scanMock).toHaveBeenCalledWith("session-1", {
      itemId: "i1",
      nfcTagId: undefined,
      observedQuantity: 4,
    });
  });
});
