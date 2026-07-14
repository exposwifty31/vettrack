/**
 * @vitest-environment happy-dom
 *
 * T-04 (R-RM-01 · CLICK-PATH-005 · HIGH) — room-radar's Return quick-action
 * sets `busyRef.current = true` before opening ReturnPlugDialog, but only
 * resets it in `returnMut.onSettled`. Canceling the dialog (without ever
 * calling `returnMut.mutate`) skips `onSettled` entirely, so `busyRef` stays
 * stuck `true` and every later tap of Return is silently swallowed by the
 * `!busyRef.current` guard — with no visual disabled state to explain why.
 *
 * This test drives the real `RadarEquipmentCard`: tap Return, cancel the
 * dialog, tap Return again — the dialog must open the second time too.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

const returnMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1", isAdmin: false }) }));
vi.mock("@/lib/haptics", () => ({ haptics: { scanSuccess: vi.fn(), tap: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        return: (...args: unknown[]) => returnMock(...args),
      },
    },
  };
});

import { RadarEquipmentCard } from "@/pages/room-radar";

afterEach(() => cleanup());

const checkedOutEquipment: Equipment = {
  id: "eq-1",
  name: "Infusion Pump",
  status: "ok",
  checkedOutById: "u1",
  checkedOutByEmail: "u1@clinic.test",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/rooms/room-1" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <RadarEquipmentCard equipment={checkedOutEquipment} staleMs={60_000} />
      </Router>
    </QueryClientProvider>,
  );
}

describe("RadarEquipmentCard — Return stays functional after a canceled dialog (T-04)", () => {
  it("opens the return dialog again after a first tap was canceled", () => {
    renderCard();

    // First tap: dialog opens.
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));
    expect(screen.getByTestId("btn-confirm-return-plug")).toBeTruthy();

    // Cancel — closes without ever calling returnMut.mutate (no onSettled).
    fireEvent.click(screen.getByText(t.returnPlugDialog.cancel));
    expect(screen.queryByTestId("btn-confirm-return-plug")).toBeNull();
    expect(returnMock).not.toHaveBeenCalled();

    // Second tap: must open again. Before the fix, busyRef stayed stuck
    // `true` from the first tap, so this second click silently no-ops.
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));
    expect(screen.getByTestId("btn-confirm-return-plug")).toBeTruthy();
  });
});
