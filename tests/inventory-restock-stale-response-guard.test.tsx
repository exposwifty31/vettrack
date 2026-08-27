/**
 * @vitest-environment happy-dom
 *
 * S18 — a restock scan that resolved LATE overwrote a newer count in the
 * TanStack cache.
 *
 * `scanLine` captures `nextValue` synchronously, then awaits twice
 * (`getOrCreateSession`, then `scanMut.mutateAsync`) before patching
 * `["/api/restock/container-items", selectedId]` with that captured value.
 * Nothing ordered those patches, so a slower EARLIER call landed on top of a
 * faster LATER one and left the cache holding a superseded quantity.
 *
 * It is invisible on screen: rows render `optimisticActualByCode[code]`, which
 * still holds the newest number. The damage surfaces one interaction later, in
 * `commitInlineEdit`:
 *
 *     if (line.sessionObservedQuantity != null && parsed === line.sessionObservedQuantity) return;
 *
 * That predicate (S13a) is correct — re-posting a count the server already
 * recorded is the one genuine no-op. But it trusts the cache. With a stale
 * `sessionObservedQuantity` sitting there, a legitimate re-count to that same
 * number is silently discarded and never reaches the server — the exact class
 * of silent-drop S13a was written to remove.
 *
 * The live route into the race is the INLINE EDIT, not a +/- burst: the +/-
 * buttons are already gated per row by `rowPendingByCode` (T-29,
 * tests/inventory-restock-burst.test.tsx), but `startInlineEdit` /
 * `commitInlineEdit` never consult it, so the editor opens and commits while a
 * tap's scan is still in flight.
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

/** Held stock is 4 on both rows; nothing recorded for this session yet. */
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

const ITEMS_KEY = ["/api/restock/container-items", "c1"] as const;

type ScanParams = { itemId?: string; nfcTagId?: string; observedQuantity: number };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/inventory" });
  const utils = render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <InventoryPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
  return { ...utils, qc };
}

function cachedLine(qc: QueryClient, code: string) {
  const data = qc.getQueryData<RestockContainerView>([...ITEMS_KEY]);
  const line = data?.lines.find((l) => l.code === code);
  if (!line) throw new Error(`no cached line for ${code}`);
  return line;
}

function quantityButton(label: string) {
  return screen.getByRole("button", { name: `Set quantity for ${label}` });
}

/** Open a row's inline editor and commit `value` from it. */
async function commitInlineCount(label: string, value: string) {
  fireEvent.click(quantityButton(label));
  const input = await screen.findByRole("spinbutton");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("InventoryPage — a late scan response cannot overwrite a newer count (S18)", () => {
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

  it("a FAILING earlier scan does not roll back over a newer count that succeeded", async () => {
    // The mirror image of the test below, and the one the rollback paths get
    // wrong when they are not ticket-gated. The success path claimed the write
    // ticket; the two rollbacks did not, and both write the `currentValue`
    // captured BEFORE their awaits.
    //
    //   1. tap Increment  -> captures currentValue 4, shows 5, scan hangs
    //   2. inline count 7 -> succeeds, claims a higher ticket, row and cache 7
    //   3. the tap's scan REJECTS -> ungated, it writes 4 back
    //
    // The row would then read 4 while server and cache hold 7 — and the S13a
    // no-op predicate would swallow a re-commit of 7, so the technician could
    // not restore the right number without a refetch.
    let rejectIncrement: ((reason?: unknown) => void) | undefined;
    scanMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectIncrement = reject; }),
    );
    scanMock.mockImplementation((_sessionId: string, params: ScanParams) =>
      Promise.resolve({
        item: { id: "i1", code: "SKU1", label: "Saline" },
        observedQuantity: params.observedQuantity,
      }),
    );

    const { qc } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Increment Saline" }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));

    await commitInlineCount("Saline", "7");
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cachedLine(qc, "SKU1").sessionObservedQuantity).toBe(7));

    rejectIncrement?.(new Error("network"));

    // Settle on the syncing indicator clearing, not on a condition that already
    // holds — see the note in the sibling test.
    await waitFor(() => expect(screen.queryByText(/Syncing/i)).toBeNull());

    expect(quantityButton("Saline").textContent).toBe("7");
    expect(cachedLine(qc, "SKU1").sessionObservedQuantity).toBe(7);
  });

  it("keeps the newer count in cache, so a later re-count to the superseded number is still posted", async () => {
    // The +1 tap's scan hangs; the inline-edited absolute 7 overtakes it.
    let resolveIncrement: ((value: unknown) => void) | undefined;
    scanMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveIncrement = resolve; }),
    );
    scanMock.mockImplementation((_sessionId: string, params: ScanParams) =>
      Promise.resolve({
        item: { id: "i1", code: "SKU1", label: "Saline" },
        observedQuantity: params.observedQuantity,
      }),
    );

    const { qc } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Increment Saline" }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(quantityButton("Saline").textContent).toBe("5");

    // The inline editor is NOT gated by rowPendingByCode, so it opens and
    // commits while the +1 above is still in flight. This is the live route.
    await commitInlineCount("Saline", "7");
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(2));
    expect(scanMock).toHaveBeenLastCalledWith("session-1", {
      itemId: "i1",
      nfcTagId: undefined,
      observedQuantity: 7,
    });
    await waitFor(() => expect(cachedLine(qc, "SKU1").sessionObservedQuantity).toBe(7));

    // Now the earlier +1 finally comes back, carrying the superseded 5.
    resolveIncrement?.({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 5,
    });
    // Wait on an OBSERVABLE EFFECT of the late response, not on a condition
    // that already holds. `scanMock` had already been called twice before this
    // resolve, and the cache already read 7 — so both of those barriers passed
    // on their first poll and proved nothing about the late response being
    // processed. `scanLine`'s `finally` clears rowPendingByCode, so the row's
    // syncing indicator disappears only once the response has settled.
    await waitFor(() => expect(screen.queryByText(/Syncing/i)).toBeNull());

    // Now the assertion is load-bearing: the cache must still describe the
    // NEWEST count, even though the late response carried the superseded 5.
    expect(cachedLine(qc, "SKU1").sessionObservedQuantity).toBe(7);
    expect(cachedLine(qc, "SKU1").actual).toBe(7);

    // The consumer that proves it: the user re-counts the row down to 5. That
    // is a real count the server has never recorded. With a stale cached
    // `sessionObservedQuantity` of 5, commitInlineEdit's S13a no-op predicate
    // swallows it and nothing is posted.
    await commitInlineCount("Saline", "5");
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(3));
    expect(scanMock).toHaveBeenLastCalledWith("session-1", {
      itemId: "i1",
      nfcTagId: undefined,
      observedQuantity: 5,
    });
  });

  it("still applies a late response when no newer write for THAT item has landed", async () => {
    // Ordering is per item, not global: Gauze finishing first must not discard
    // Saline's own (still-newest-for-Saline) response.
    let resolveSaline: ((value: unknown) => void) | undefined;
    scanMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSaline = resolve; }),
    );
    scanMock.mockImplementation((_sessionId: string, params: ScanParams) =>
      Promise.resolve({
        item: { id: "i2", code: "SKU2", label: "Gauze" },
        observedQuantity: params.observedQuantity,
      }),
    );

    const { qc } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Increment Saline" }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Increment Gauze" }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cachedLine(qc, "SKU2").sessionObservedQuantity).toBe(5));

    resolveSaline?.({
      item: { id: "i1", code: "SKU1", label: "Saline" },
      observedQuantity: 5,
    });

    await waitFor(() => {
      expect(cachedLine(qc, "SKU1").sessionObservedQuantity).toBe(5);
      expect(cachedLine(qc, "SKU1").actual).toBe(5);
    });
    expect(cachedLine(qc, "SKU2").sessionObservedQuantity).toBe(5);
  });
});
