/**
 * @vitest-environment happy-dom
 *
 * T1.6 (docking-as-first-class P1) — AdminDocksPage: the dock-create form
 * gains a Category (asset type) select and a Capacity number input, and
 * createDock must forward assetTypeId/capacity alongside name/roomId.
 *
 * Radix Select needs pointer-capture/portal machinery this suite does not
 * exercise (see tests/users-secondary-role-pending.test.tsx for the same
 * rationale) — stand in with a native <select> driven by the same
 * value/onValueChange contract so the wiring under test (which fields
 * createMut sends) is exercised directly instead of fighting Radix's popup
 * internals in happy-dom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import * as React from "react";
import { t } from "@/lib/i18n";
import type { AssetType, Dock, Room } from "@/types";

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

const listDocksMock = vi.fn();
const listRoomsMock = vi.fn();
const listAssetTypesMock = vi.fn();
const createDockMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      rooms: {
        ...actual.api.rooms,
        list: (...a: unknown[]) => listRoomsMock(...a),
      },
      operationalState: {
        ...actual.api.operationalState,
        listDocks: (...a: unknown[]) => listDocksMock(...a),
        listAssetTypes: (...a: unknown[]) => listAssetTypesMock(...a),
        createDock: (...a: unknown[]) => createDockMock(...a),
      },
    },
  };
});

import AdminDocksPage from "@/pages/AdminDocksPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <AdminDocksPage />
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const assetTypes: AssetType[] = [
  { id: "at-1", clinicId: "clinic-1", name: "Pump", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "at-2", clinicId: "clinic-1", name: "Monitor", createdAt: "2026-01-01T00:00:00.000Z" },
];

const rooms: Room[] = [{ id: "room-1", name: "ICU", clinicId: "clinic-1" } as Room];

const existingDocks: Dock[] = [
  {
    id: "dock-1",
    clinicId: "clinic-1",
    name: "Pump Station",
    description: null,
    roomId: "room-1",
    roomName: "ICU",
    assetTypeId: "at-1",
    assetTypeName: "Pump",
    capacity: 4,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("AdminDocksPage — Category + Capacity (T1.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDocksMock.mockResolvedValue(existingDocks);
    listRoomsMock.mockResolvedValue(rooms);
    listAssetTypesMock.mockResolvedValue(assetTypes);
    createDockMock.mockResolvedValue({ ...existingDocks[0], id: "dock-2" });
  });

  it("renders a Category select populated from the asset-types list", async () => {
    renderPage();

    const categorySelect = (await screen.findByTestId(
      "dock-category-select",
    )) as HTMLSelectElement;
    await waitFor(() => {
      const optionLabels = Array.from(categorySelect.options).map((o) => o.textContent);
      expect(optionLabels).toContain("Pump");
      expect(optionLabels).toContain("Monitor");
    });
  });

  it("shows category name and capacity on each dock row", async () => {
    renderPage();

    expect(await screen.findByText("Pump Station")).toBeTruthy();
    // roomName · assetTypeName · capacityLabel, joined per the existing row layout.
    expect(screen.getByText(`ICU · Pump · ${t.adminDocks.capacityLabel} 4`)).toBeTruthy();
  });

  it("sends assetTypeId and capacity (as a number) to createDock on Add", async () => {
    renderPage();

    const nameInput = await screen.findByPlaceholderText(t.adminDocks.namePlaceholder);
    fireEvent.change(nameInput, { target: { value: "New Dock" } });

    const categorySelect = (await screen.findByTestId(
      "dock-category-select",
    )) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "at-2" } });

    const capacityInput = screen.getByTestId("dock-capacity-input") as HTMLInputElement;
    fireEvent.change(capacityInput, { target: { value: "6" } });

    fireEvent.click(screen.getByTestId("btn-add-dock"));

    await waitFor(() =>
      expect(createDockMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Dock",
          assetTypeId: "at-2",
          capacity: 6,
        }),
      ),
    );
  });
});
