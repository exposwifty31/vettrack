/**
 * @vitest-environment happy-dom
 *
 * T-20 (R-EQ-06 · CLICK-PATH-021 · Tier S) — on My Equipment, a single
 * shared `returnMut` mutation drives the spinner/disabled state on the
 * per-row Return button. Gating on `returnMut.isPending` alone means
 * confirming a return for ONE row flips every OTHER row's Return button
 * into a spinner + disabled state too, even though only one return is
 * actually in flight.
 *
 * This test drives the real page: it confirms a return for eq-1 via the
 * real ReturnPlugDialog, then — while that return call is still pending —
 * asserts eq-1's Return button shows the spinner and is disabled, while
 * eq-2's Return button stays interactive (not disabled, still showing the
 * "Return" label, not the spinner).
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe("my-equipment — Return spinner/disable scopes to the active row (T-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Never resolves within the test — keeps the mutation pending so we can
    // assert the mid-flight spinner/disabled scoping.
    returnMock.mockImplementation(() => new Promise(() => {}));
  });

  it("only the row being returned shows the spinner/disabled state; sibling rows stay interactive", async () => {
    renderPage();

    await screen.findByTestId("btn-return-eq-1");
    fireEvent.click(screen.getByTestId("btn-return-eq-1"));

    const confirmButton = await screen.findByTestId("btn-confirm-return-plug");
    fireEvent.click(confirmButton);

    await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    expect(returnMock).toHaveBeenCalledWith("eq-1", { isPluggedIn: true, plugInDeadlineMinutes: undefined });

    await waitFor(() => {
      const returningButton = screen.getByTestId("btn-return-eq-1") as HTMLButtonElement;
      expect(returningButton.disabled).toBe(true);
    });
    // The active row shows the spinner only (no "Return" label alongside it).
    expect(screen.getByTestId("btn-return-eq-1").textContent).not.toMatch(/Return/);

    // The sibling row must stay interactive — not disabled, still showing
    // its normal "Return" label rather than a spinner.
    const siblingButton = screen.getByTestId("btn-return-eq-2") as HTMLButtonElement;
    expect(siblingButton.disabled).toBe(false);
    expect(siblingButton.textContent).toMatch(/Return/);
  });
});
