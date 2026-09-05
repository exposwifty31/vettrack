/**
 * @vitest-environment happy-dom
 *
 * Track B / Phase 3 — in-row status change for the desktop `/equipment` console.
 *
 * Route choice matters here. The detail page changes status via
 * `api.equipment.scan`, which also stamps `lastSeen` and inserts a `scanLogs` row
 * (`server/routes/equipment.ts:830,852`) — a physical-presence claim. A manager at a
 * desk did not see the item, and `lastSeen` feeds the staleness/"missing" counts on
 * `/home` and `/dashboard`. So the console writes through PATCH instead, which the
 * server already accepts (`patchEquipmentSchema:124`) without touching `lastSeen`.
 *
 * The payload assertion is the load-bearing one: PATCH must carry ONLY `status`.
 * An omitted key is preserved server-side; echoing a whole form would blank fields
 * the console never sourced.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import type { Equipment } from "@/types";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1", isAdmin: true }) }));

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn(async () => ({})) }));
vi.mock("@/lib/api", () => ({
  api: { equipment: { update: (...a: unknown[]) => updateMock(...a) } },
}));

import { EquipmentStatusSheet } from "@/features/equipment/desktop/EquipmentStatusSheet";

const EQ = { id: "e1", name: "Ultrasound A", status: "ok" } as Equipment;

function renderSheet(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onOpenChange,
    ...render(
      <QueryClientProvider client={qc}>
        <EquipmentStatusSheet equipment={EQ} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  updateMock.mockClear();
});

describe("EquipmentStatusSheet — console status change", () => {
  it("offers the same four statuses the detail dialog offers", () => {
    renderSheet();
    for (const s of ["ok", "issue", "maintenance", "sterilized"]) {
      expect(screen.getByTestId(`equipment-status-option-${s}`)).toBeTruthy();
    }
    // Not the derived/server-only ones.
    expect(screen.queryByTestId("equipment-status-option-overdue")).toBeNull();
    expect(screen.queryByTestId("equipment-status-option-critical")).toBeNull();
  });

  it("PATCHes ONLY the status field — never a whole-object echo", async () => {
    renderSheet();

    fireEvent.click(screen.getByTestId("equipment-status-option-maintenance"));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock).toHaveBeenCalledWith("e1", { status: "maintenance" });
    expect(Object.keys(updateMock.mock.calls[0][1] as object)).toEqual(["status"]);
  });

  it("closes the sheet once the write succeeds", async () => {
    const { onOpenChange } = renderSheet();

    fireEvent.click(screen.getByTestId("equipment-status-option-issue"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("labels each option with the shared localized status label", () => {
    renderSheet();
    expect(
      screen.getByTestId("equipment-status-option-issue").textContent,
    ).toContain(equipmentStatusLabel("issue"));
  });
});
