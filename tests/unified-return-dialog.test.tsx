/**
 * @vitest-environment happy-dom
 *
 * T2.3 (docking P2) — UnifiedReturnDialog collapses the plain "Return" and
 * separate "Dock return" flows behind one home-station toggle:
 *   - CHECKED  → dock-return endpoint (writes the docking anchor, T2.4).
 *   - UNCHECKED → plain custody return, preserving ReturnPlugDialog's
 *     plugged-in / plug-deadline / damaged behavior verbatim (via the shared
 *     PlugStatusFields it reuses).
 *
 * Component-level test: renders UnifiedReturnDialog in isolation with a
 * mocked @/lib/api, not the full equipment-detail.tsx page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import type { Dock, Equipment } from "@/types";

afterEach(() => cleanup());

const listDocksMock = vi.fn();
const listConditionsMock = vi.fn();
const conditionStatesMock = vi.fn();
const dockReturnMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      operationalState: {
        ...actual.api.operationalState,
        listDocks: (...args: unknown[]) => listDocksMock(...args),
        listConditions: (...args: unknown[]) => listConditionsMock(...args),
        conditionStates: (...args: unknown[]) => conditionStatesMock(...args),
        dockReturn: (...args: unknown[]) => dockReturnMock(...args),
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { UnifiedReturnDialog } from "@/components/equipment/UnifiedReturnDialog";
import { resolveHomeDock } from "@/lib/dock-resolution";
import { toast } from "sonner";

const HOME_DOCK: Dock = {
  id: "dock-1",
  clinicId: "clinic-1",
  name: "ICU Charging Station",
  roomId: "room-1",
  assetTypeId: "asset-pump",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function baseEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq1",
    name: "Infusion Pump",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDialog(props: Partial<ComponentProps<typeof UnifiedReturnDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onConfirmReturn = vi.fn();
  const onDockReturnSuccess = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <UnifiedReturnDialog
        open
        equipment={baseEquipment()}
        equipmentName="Infusion Pump"
        allowDamagedReport
        onOpenChange={onOpenChange}
        onConfirmReturn={onConfirmReturn}
        onDockReturnSuccess={onDockReturnSuccess}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { client, onOpenChange, onConfirmReturn, onDockReturnSuccess };
}

describe("resolveHomeDock (client mirror of server/services/docking.service.ts)", () => {
  it("matches a dock by roomId + assetTypeId", () => {
    expect(resolveHomeDock({ homeRoomId: "room-1", assetTypeId: "asset-pump" }, [HOME_DOCK])).toBe(HOME_DOCK);
  });

  it("returns null when homeRoomId is missing", () => {
    expect(resolveHomeDock({ homeRoomId: null, assetTypeId: "asset-pump" }, [HOME_DOCK])).toBeNull();
  });

  it("returns null when no dock matches", () => {
    expect(resolveHomeDock({ homeRoomId: "room-2", assetTypeId: "asset-pump" }, [HOME_DOCK])).toBeNull();
  });
});

describe("UnifiedReturnDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe defaults — individual tests override with .mockResolvedValue(...)
    // where a different value matters. Every render risks kicking off the
    // conditions/condition-states queries (enabled whenever the toggle
    // defaults to checked + the fixture has an assetTypeId), so these must
    // always resolve to *something* even when a test doesn't care about them.
    listDocksMock.mockResolvedValue([]);
    listConditionsMock.mockResolvedValue([]);
    conditionStatesMock.mockResolvedValue([]);
    dockReturnMock.mockResolvedValue({ equipmentId: "eq1", readinessState: "ready", custodyState: "docked" });
  });

  it("(c) toggle label shows the derived home-station name when a matching dock exists", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);
    renderDialog({
      equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
    });

    expect(await screen.findByText("ICU Charging Station", { exact: false })).toBeTruthy();
    expect(screen.getByTestId("toggle-return-to-station")).toBeTruthy();
  });

  it("(a) toggle CHECKED + submit calls the dock-return endpoint, not plain return", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);
    listConditionsMock.mockResolvedValue([]);
    conditionStatesMock.mockResolvedValue([]);
    dockReturnMock.mockResolvedValue({ equipmentId: "eq1", readinessState: "ready", custodyState: "docked" });

    const { onConfirmReturn, onDockReturnSuccess } = renderDialog({
      equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
    });

    // Home dock resolves asynchronously — wait for the derived label before
    // trusting the toggle's default-checked state.
    await screen.findByText("ICU Charging Station", { exact: false });
    const toggle = screen.getByTestId("toggle-return-to-station") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));
    expect(dockReturnMock).toHaveBeenCalledWith(
      "eq1",
      expect.objectContaining({ dockId: "dock-1", conditionVerifications: [] }),
    );
    expect(onConfirmReturn).not.toHaveBeenCalled();
    await waitFor(() => expect(onDockReturnSuccess).toHaveBeenCalledTimes(1));
  });

  it("(b) toggle UNCHECKED + submit calls the plain return path, not dock-return", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);

    const { onConfirmReturn } = renderDialog({
      equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
    });

    await screen.findByText("ICU Charging Station", { exact: false });
    fireEvent.click(screen.getByTestId("toggle-return-to-station"));

    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    expect(onConfirmReturn).toHaveBeenCalledTimes(1);
    expect(onConfirmReturn).toHaveBeenCalledWith(expect.objectContaining({ isPluggedIn: true }));
    expect(dockReturnMock).not.toHaveBeenCalled();
  });

  it("(d) homeRoomId === null disables the toggle and defaults to the plain-return path", async () => {
    listDocksMock.mockResolvedValue([]);

    const { onConfirmReturn } = renderDialog({
      equipment: baseEquipment({ homeRoomId: null, assetTypeId: "asset-pump" }),
    });

    const toggle = (await screen.findByTestId("toggle-return-to-station")) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId("unified-return-no-home-hint")).toBeTruthy();

    // Plain-return UI (ReturnPlugDialog's reused PlugStatusFields) is already
    // showing — no extra step needed to reach it.
    expect(screen.getByTestId("btn-plugged-yes")).toBeTruthy();

    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    expect(onConfirmReturn).toHaveBeenCalledTimes(1);
    expect(dockReturnMock).not.toHaveBeenCalled();
  });

  it("preserves the 'returned damaged' third choice on the unchecked (plain-return) path", async () => {
    listDocksMock.mockResolvedValue([]);
    const { onConfirmReturn } = renderDialog({
      equipment: baseEquipment({ homeRoomId: null }),
    });

    await screen.findByTestId("btn-plugged-yes");
    fireEvent.click(screen.getByTestId("btn-returned-damaged"));
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    expect(onConfirmReturn).toHaveBeenCalledWith(expect.objectContaining({ damaged: true }));
  });

  it("shows the asset-typed condition checklist on the checked (dock-return) path", async () => {
    listDocksMock.mockResolvedValue([HOME_DOCK]);
    listConditionsMock.mockResolvedValue([
      { id: "cond-1", assetTypeId: "asset-pump", conditionName: "Battery charged", verificationMethod: "visual", staleAfterMinutes: 60, displayOrder: 1 },
    ]);
    conditionStatesMock.mockResolvedValue([]);

    renderDialog({
      equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
    });

    expect(await screen.findByText("Battery charged")).toBeTruthy();
  });

  describe("CodeRabbit #11/#12 (P2 review) — dock-return cache invalidation + error surfacing", () => {
    it("#11 — dockReturn success invalidates the real equipment-detail query key (templated string, not a 2-element array)", async () => {
      listDocksMock.mockResolvedValue([HOME_DOCK]);
      dockReturnMock.mockResolvedValue({ equipmentId: "eq1", readinessState: "ready", custodyState: "docked" });

      const { client } = renderDialog({
        equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
      });
      const invalidateSpy = vi.spyOn(client, "invalidateQueries");

      await screen.findByText("ICU Charging Station", { exact: false });
      fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

      await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));

      // The real detail query key is `[`/api/equipment/${id}`]` (a single
      // templated string) — a 2-element `["/api/equipment", id]` key never
      // prefix-matches it and silently no-ops.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/equipment/eq1"] });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["/api/equipment", "eq1"] });
    });

    it("#12 — dockReturn failure surfaces the real error message instead of the generic fallback", async () => {
      listDocksMock.mockResolvedValue([HOME_DOCK]);
      dockReturnMock.mockRejectedValue(new Error("dock is full"));

      renderDialog({
        equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
      });

      await screen.findByText("ICU Charging Station", { exact: false });
      fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

      await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("dock is full"));
    });

    it("#12 — dockReturn failure without a message falls back to the generic copy", async () => {
      listDocksMock.mockResolvedValue([HOME_DOCK]);
      dockReturnMock.mockRejectedValue("not an Error instance");

      renderDialog({
        equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
      });

      await screen.findByText("ICU Charging Station", { exact: false });
      fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

      await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });
  });

  describe("I-1 (P2 review) — offline-safe dock-return default", () => {
    afterEach(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    });

    it("homed + ONLINE still defaults to the dock-return path (locks the existing branch)", async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      listDocksMock.mockResolvedValue([HOME_DOCK]);

      const { onConfirmReturn } = renderDialog({
        equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
      });

      await screen.findByText("ICU Charging Station", { exact: false });
      expect(screen.getByTestId("unified-return-dock-body")).toBeTruthy();
      const toggle = screen.getByTestId("toggle-return-to-station") as HTMLInputElement;
      expect(toggle.checked).toBe(true);

      fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

      await waitFor(() => expect(dockReturnMock).toHaveBeenCalledTimes(1));
      expect(onConfirmReturn).not.toHaveBeenCalled();
    });

    it("homed + OFFLINE routes to the offline-capable plain return, NOT dockReturn", async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      listDocksMock.mockResolvedValue([HOME_DOCK]);

      const { onConfirmReturn } = renderDialog({
        equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
      });

      // Plain-return body (PlugStatusFields) renders — the dock body does not,
      // even though this item has a resolvable home dock.
      const plugYes = await screen.findByTestId("btn-plugged-yes");
      expect(plugYes).toBeTruthy();
      expect(screen.queryByTestId("unified-return-dock-body")).toBeNull();
      expect(screen.getByTestId("unified-return-offline-hint")).toBeTruthy();

      // Confirm is NOT stuck disabled behind the unresolved-dock guard.
      const confirmBtn = screen.getByTestId("btn-confirm-return-plug") as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(false);

      fireEvent.click(confirmBtn);

      await waitFor(() => expect(onConfirmReturn).toHaveBeenCalledTimes(1));
      expect(dockReturnMock).not.toHaveBeenCalled();
    });

    it("offline + homed disables the dock-toggle checkbox (can't turn dock-return on)", async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      listDocksMock.mockResolvedValue([HOME_DOCK]);

      renderDialog({
        equipment: baseEquipment({ homeRoomId: "room-1", assetTypeId: "asset-pump" }),
      });

      const toggle = (await screen.findByTestId("toggle-return-to-station")) as HTMLInputElement;
      expect(toggle.checked).toBe(false);
      expect(toggle.disabled).toBe(true);
    });
  });
});
