/**
 * @vitest-environment happy-dom
 *
 * T3.6b (docking P3) — AdminHomeAssignmentPage: full 8-bucket reconciliation
 * worklist. Extends the T1.7 page (bulk Home Room assignment + the two
 * ownership-derivable buckets) with:
 *   1. A bucket-counts summary covering all 8 buckets (§6.1).
 *   2. Actionable worklist sections for the operational drift buckets the
 *      page does not already cover: missing, returned_away,
 *      misplaced_at_station, returned_unverified.
 *   3. at_home/checked_out are "accounted" — counts only, no section.
 *
 * Same Radix Select stand-in rationale as tests/admin-home-assignment.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import * as React from "react";
import { t } from "@/lib/i18n";
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
];

const reconciliation: DockingReconciliation = {
  unassigned: [{ id: "un-1", name: "Unassigned Monitor", homeRoomId: null, assetTypeId: null }],
  noStation: [{ id: "ns-1", name: "No-Station Otoscope", homeRoomId: "room-1", assetTypeId: "at-1" }],
  byDock: [],
  counts: {
    at_home: 12,
    checked_out: 5,
    returned_unverified: 2,
    returned_away: 1,
    misplaced_at_station: 3,
    missing: 4,
    unassigned: 1,
    no_station: 1,
  },
  byBucket: {
    at_home: [],
    checked_out: [],
    returned_unverified: [
      {
        id: "ru-1",
        name: "Returned Unverified Pump",
        bucket: "returned_unverified",
        custodyState: "returned",
        checkedOutById: null,
        checkedOutByEmail: null,
        homeDockId: "dock-1",
        homeDockName: "ICU Dock",
        homeRoomId: "room-1",
      },
    ],
    returned_away: [
      {
        id: "ra-1",
        name: "Returned Away Monitor",
        bucket: "returned_away",
        custodyState: "returned",
        checkedOutById: null,
        checkedOutByEmail: null,
        homeDockId: "dock-1",
        homeDockName: "ICU Dock",
        homeRoomId: "room-1",
      },
    ],
    // Deliberately empty — exercises the muted empty state for a drift bucket.
    misplaced_at_station: [],
    missing: [
      {
        id: "mi-1",
        name: "Missing Ventilator",
        bucket: "missing",
        custodyState: "returned",
        checkedOutById: null,
        checkedOutByEmail: null,
        homeDockId: null,
        homeDockName: null,
        homeRoomId: "room-1",
      },
    ],
    unassigned: [],
    no_station: [],
  },
};

describe("AdminHomeAssignmentPage — full 8-bucket reconciliation worklist (T3.6b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEquipmentMock.mockResolvedValue(pumps);
    listRoomsMock.mockResolvedValue(rooms);
    listAssetTypesMock.mockResolvedValue(assetTypes);
    reconciliationMock.mockResolvedValue(reconciliation);
    assignHomeBulkMock.mockResolvedValue({ updated: 1 });
  });

  it("renders all 8 bucket counts in the summary", async () => {
    renderPage();

    const buckets = [
      "at_home",
      "checked_out",
      "returned_unverified",
      "returned_away",
      "misplaced_at_station",
      "missing",
      "unassigned",
      "no_station",
    ] as const;

    for (const bucket of buckets) {
      const chip = await screen.findByTestId(`bucket-count-${bucket}`);
      await waitFor(() => expect(chip.textContent).toContain(String(reconciliation.counts[bucket])));
    }
  });

  it("shows a missing item in the missing section with its name and bucket badge", async () => {
    renderPage();

    const section = await screen.findByTestId("reconciliation-section-missing");
    expect(await within(section).findByText("Missing Ventilator")).toBeTruthy();
    const row = within(section).getByTestId("reconciliation-item-mi-1");
    expect(within(row).getAllByText(t.adminHomeAssignment.bucketLabels.missing).length).toBeGreaterThan(0);
  });

  it("shows a returned_away item in the returned_away section", async () => {
    renderPage();

    const section = await screen.findByTestId("reconciliation-section-returned_away");
    expect(await within(section).findByText("Returned Away Monitor")).toBeTruthy();
  });

  it("renders a muted empty state for a drift bucket with no items", async () => {
    renderPage();

    const section = await screen.findByTestId("reconciliation-section-misplaced_at_station");
    expect(
      await within(section).findByText(t.adminHomeAssignment.driftBuckets.misplaced_at_station.empty),
    ).toBeTruthy();
  });

  it("does not render a worklist section for at_home or checked_out (counts only)", async () => {
    renderPage();

    await screen.findByTestId("bucket-count-at_home");
    expect(screen.queryByTestId("reconciliation-section-at_home")).toBeNull();
    expect(screen.queryByTestId("reconciliation-section-checked_out")).toBeNull();
  });

  it("still renders the existing Unassigned and No Station sections (no regression)", async () => {
    renderPage();

    expect(await screen.findByText("Unassigned Monitor")).toBeTruthy();
    expect(await screen.findByText("No-Station Otoscope")).toBeTruthy();
  });

  it("shows an error state (not eight 0 chips) when reconciliation fetch fails, and retry refetches", async () => {
    reconciliationMock.mockRejectedValueOnce(new Error("network down"));
    renderPage();

    const errors = await screen.findAllByText(t.adminHomeAssignment.reconciliationLoadError);
    expect(errors.length).toBeGreaterThan(0);
    // The all-zero bucket-count chip row must NOT render on error.
    expect(screen.queryByTestId("reconciliation-bucket-counts")).toBeNull();

    reconciliationMock.mockResolvedValueOnce(reconciliation);
    const retryButtons = screen.getAllByRole("button", { name: t.errorCard.retry });
    fireEvent.click(retryButtons[0]);

    await waitFor(() => expect(reconciliationMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("reconciliation-bucket-counts")).toBeTruthy();
  });
});
