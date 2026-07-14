/**
 * @vitest-environment happy-dom
 *
 * T1.7 (docking-as-first-class P1) — AdminHomeAssignmentPage: bulk Home
 * Room (+ Category) assignment plus the two P1 reconciliation buckets
 * (Unassigned, No Station).
 *
 * Radix Select needs pointer-capture/portal machinery this suite does not
 * exercise (see tests/admin-docks-page.test.tsx for the same rationale) —
 * stand in with a native <select> driven by the same value/onValueChange
 * contract so the wiring under test (which ids/room get sent) is exercised
 * directly instead of fighting Radix's popup internals in happy-dom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { toast } from "sonner";
import * as React from "react";
import { ApiError } from "@/lib/api";
import type { AssetType, DockingReconciliation, Equipment, Room } from "@/types";

afterEach(() => cleanup());

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ role: "admin", userId: "admin-1", isAdmin: true }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => {
  function SelectTrigger({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectContent({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectItem({ children, value }: { children?: React.ReactNode; value: string }) {
    return <option value={value}>{children}</option>;
  }
  function SelectValue() {
    return null;
  }
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) {
    const kids = React.Children.toArray(children) as React.ReactElement<any>[];
    const trigger = kids.find((k) => k.type === SelectTrigger);
    const content = kids.find((k) => k.type === SelectContent);
    const testId = trigger?.props?.["data-testid"];
    const items = content
      ? (React.Children.toArray(content.props.children) as React.ReactElement<any>[])
      : [];
    return (
      <select data-testid={testId} value={value} onChange={(e) => onValueChange(e.target.value)}>
        {items.map((item) => (
          <option key={item.props.value} value={item.props.value}>
            {item.props.children}
          </option>
        ))}
      </select>
    );
  }
  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

const listEquipmentMock = vi.fn();
const listRoomsMock = vi.fn();
const listAssetTypesMock = vi.fn();
const reconciliationMock = vi.fn();
const assignHomeBulkMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        list: (...a: unknown[]) => listEquipmentMock(...a),
      },
      rooms: {
        ...actual.api.rooms,
        list: (...a: unknown[]) => listRoomsMock(...a),
      },
      operationalState: {
        ...actual.api.operationalState,
        listAssetTypes: (...a: unknown[]) => listAssetTypesMock(...a),
      },
      docking: {
        ...actual.api.docking,
        reconciliation: (...a: unknown[]) => reconciliationMock(...a),
        assignHomeBulk: (...a: unknown[]) => assignHomeBulkMock(...a),
      },
    },
  };
});

import AdminHomeAssignmentPage from "@/pages/AdminHomeAssignmentPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <AdminHomeAssignmentPage />
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const assetTypes: AssetType[] = [
  { id: "at-1", clinicId: "clinic-1", name: "Pump", createdAt: "2026-01-01T00:00:00.000Z" },
];

const rooms: Room[] = [{ id: "room-1", name: "ICU" } as Room];

const pumps: Equipment[] = [
  { id: "eq-1", name: "Pump A", assetTypeId: "at-1", status: "available", createdAt: "2026-01-01T00:00:00.000Z" } as Equipment,
  { id: "eq-2", name: "Pump B", assetTypeId: "at-1", status: "available", createdAt: "2026-01-01T00:00:00.000Z" } as Equipment,
];

const reconciliation: DockingReconciliation = {
  unassigned: [
    { id: "un-1", name: "Unassigned Monitor", homeRoomId: null, assetTypeId: null },
    { id: "un-2", name: "Unassigned Pump", homeRoomId: null, assetTypeId: "at-1" },
  ],
  noStation: [{ id: "ns-1", name: "No-Station Otoscope", homeRoomId: "room-1", assetTypeId: "at-1" }],
  byDock: [],
};

describe("AdminHomeAssignmentPage — bulk home assignment + reconciliation buckets (T1.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEquipmentMock.mockResolvedValue(pumps);
    listRoomsMock.mockResolvedValue(rooms);
    listAssetTypesMock.mockResolvedValue(assetTypes);
    reconciliationMock.mockResolvedValue(reconciliation);
    assignHomeBulkMock.mockResolvedValue({ updated: 2 });
  });

  it("selects two pumps + a room and calls assignHomeBulk with both ids and the room on Assign", async () => {
    renderPage();

    const pumpACheckbox = await screen.findByRole("checkbox", { name: "Pump A" });
    const pumpBCheckbox = await screen.findByRole("checkbox", { name: "Pump B" });
    fireEvent.click(pumpACheckbox);
    fireEvent.click(pumpBCheckbox);

    const roomSelect = (await screen.findByTestId("home-assignment-room-select")) as HTMLSelectElement;
    fireEvent.change(roomSelect, { target: { value: "room-1" } });

    fireEvent.click(screen.getByTestId("btn-assign-home-bulk"));

    await waitFor(() => expect(assignHomeBulkMock).toHaveBeenCalledTimes(1));
    const call = assignHomeBulkMock.mock.calls[0][0];
    expect([...call.ids].sort()).toEqual(["eq-1", "eq-2"]);
    expect(call.homeRoomId).toBe("room-1");
  });

  it("assigns category to uncategorized equipment when category is selected", async () => {
    const uncategorized: Equipment = {
      id: "eq-3",
      name: "Uncategorized Device",
      assetTypeId: null,
      status: "available",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as Equipment;
    listEquipmentMock.mockResolvedValue([...pumps, uncategorized]);
    assignHomeBulkMock.mockResolvedValue({ updated: 1 });

    renderPage();

    const categorySelect = (await screen.findByTestId("home-assignment-category-select")) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "at-1" } });

    const uncategorizedCheckbox = await screen.findByRole("checkbox", { name: "Uncategorized Device" });
    fireEvent.click(uncategorizedCheckbox);

    const roomSelect = (await screen.findByTestId("home-assignment-room-select")) as HTMLSelectElement;
    fireEvent.change(roomSelect, { target: { value: "room-1" } });

    fireEvent.click(screen.getByTestId("btn-assign-home-bulk"));

    await waitFor(() => expect(assignHomeBulkMock).toHaveBeenCalledTimes(1));
    const call = assignHomeBulkMock.mock.calls[0][0];
    expect(call.ids).toEqual(["eq-3"]);
    expect(call.homeRoomId).toBe("room-1");
    expect(call.assetTypeId).toBe("at-1");
  });

  it("shows an error toast when assignHomeBulk rejects instead of failing silently", async () => {
    assignHomeBulkMock.mockRejectedValueOnce(new ApiError(500, "Failed to assign Home Room", {}));
    renderPage();

    const pumpACheckbox = await screen.findByRole("checkbox", { name: "Pump A" });
    fireEvent.click(pumpACheckbox);

    const roomSelect = (await screen.findByTestId("home-assignment-room-select")) as HTMLSelectElement;
    fireEvent.change(roomSelect, { target: { value: "room-1" } });

    fireEvent.click(screen.getByTestId("btn-assign-home-bulk"));

    await waitFor(() => expect(assignHomeBulkMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to assign Home Room"));
  });

  it("renders the Unassigned section with reconciliation.unassigned items", async () => {
    renderPage();

    expect(await screen.findByText("Unassigned Monitor")).toBeTruthy();
  });

  it("renders the No Station section with reconciliation.noStation items", async () => {
    renderPage();

    expect(await screen.findByText("No-Station Otoscope")).toBeTruthy();
  });

  it("disables one-tap Assign home for a category-less Unassigned item (I1)", async () => {
    renderPage();

    const btn = (await screen.findByTestId("btn-assign-home-un-1")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fireEvent.click(btn);
    expect(assignHomeBulkMock).not.toHaveBeenCalled();
  });

  it("keeps one-tap Assign home enabled for an Unassigned item only missing a home room (I1)", async () => {
    renderPage();

    // Wait for the reconciliation-derived button first, same as roomsQ this
    // gives react-query enough ticks to resolve so the room <option> exists
    // before we try to select it.
    const btn = (await screen.findByTestId("btn-assign-home-un-2")) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    const roomSelect = (await screen.findByTestId("home-assignment-room-select")) as HTMLSelectElement;
    await waitFor(() => expect(roomSelect.querySelector('option[value="room-1"]')).toBeTruthy());
    fireEvent.change(roomSelect, { target: { value: "room-1" } });

    fireEvent.click(btn);

    await waitFor(() => expect(assignHomeBulkMock).toHaveBeenCalledTimes(1));
    expect(assignHomeBulkMock).toHaveBeenCalledWith({ ids: ["un-2"], homeRoomId: "room-1" });
  });
});
