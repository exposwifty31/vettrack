/**
 * @vitest-environment happy-dom
 *
 * T-19 (R-EQ-05 · CLICK-PATH-020 · Tier S) — "Return All" on My Equipment
 * awaited `Promise.all` across the individual per-item return calls.
 * `Promise.all` rejects on the FIRST failure, which throws before the three
 * `invalidateQueries()` calls that follow it ever run — so on a partial
 * failure (one item's return call rejects) the query cache stays stale for
 * every item that DID return successfully.
 *
 * This test drives the real `handleReturnAll` behavior via the rendered
 * page: with 3 items where ONE return call rejects, the cache invalidations
 * for the other (successful) returns must still fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import type { ReactNode } from "react";
import type { Equipment } from "@/types";

afterEach(() => cleanup());

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u1", isAdmin: false }),
}));
vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const returnMock = vi.fn();

const items: Equipment[] = [
  {
    id: "eq-1",
    name: "Otoscope",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    checkedOutAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "eq-2",
    name: "Stethoscope",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    checkedOutAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "eq-3",
    name: "Thermometer",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    checkedOutAt: "2026-01-01T00:00:00.000Z",
  },
];

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        listMy: async () => items,
        return: (...args: unknown[]) => returnMock(...args),
      },
    },
  };
});

import MyEquipmentPage from "@/pages/my-equipment";

function renderPage(client: QueryClient) {
  const { hook } = memoryLocation({ path: "/my-equipment" });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <Router hook={hook}>
          <MyEquipmentPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("my-equipment — Return All invalidates after allSettled (T-19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still invalidates the caches for the successful returns when one return call rejects", async () => {
    returnMock.mockImplementation((id: string) => {
      if (id === "eq-2") {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve({ equipment: { id, status: "returned" }, undoToken: undefined });
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderPage(client);

    const returnAllButton = await screen.findByTestId("btn-return-all");
    fireEvent.click(returnAllButton);

    // The confirm dialog is mocked to auto-resolve true, so all three return
    // calls should be issued.
    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(3));

    // Even though eq-2's return rejected, the invalidations for the
    // successful returns (eq-1, eq-3) must still run.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/equipment/my"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/equipment"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/activity"] });
  });

  it("disables individual return buttons while Return All is in flight", async () => {
    const pendingResolvers: Array<() => void> = [];
    returnMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingResolvers.push(() =>
            resolve({ equipment: { status: "returned" }, undoToken: undefined }),
          );
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(client);

    const returnAllButton = await screen.findByTestId("btn-return-all");
    const individualButton = await screen.findByTestId("btn-return-eq-1");
    expect(individualButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(returnAllButton);

    // The bulk operation submits every item's return call before any of
    // them resolve — an individual return button must not remain clickable
    // and let the same equipment be submitted a second time concurrently.
    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(individualButton.hasAttribute("disabled")).toBe(true));

    pendingResolvers.forEach((resolve) => resolve());
    await waitFor(() => expect(individualButton.hasAttribute("disabled")).toBe(false));
  });
});
