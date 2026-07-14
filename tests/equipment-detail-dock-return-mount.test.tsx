/**
 * @vitest-environment happy-dom
 *
 * T-02 (R-EQ-01/02 · CLICK-PATH-002/003 · HIGH · Tier S) — in
 * src/pages/equipment-detail.tsx, `setDockReturnOpen(true)` (btn-dock-return)
 * and `onRfidAttention` (equipment-detail-rfid-attention) are the triggers,
 * but the only consumers <DockReturnFlow> and <DockReturnNfc> are mounted
 * *inside* `<TabsContent value="readiness">` — a bare Radix
 * `TabsPrimitive.Content` with no `forceMount`. Radix doesn't render a
 * Content panel's children at all when its tab isn't the active one, so on
 * the default "details" tab neither sheet exists in the React tree at all —
 * both triggers become silent no-ops.
 *
 * This test drives the real default export on the default tab (never
 * switching to "readiness") and asserts each sheet actually renders when
 * triggered. Heavy, unrelated page-level panels (EquipmentTruthCard,
 * AssetCopilotPanel, EquipmentDetailDetailsTab) are stubbed so the test stays
 * scoped to the mount-location defect, not their own data fetching.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";
import type { ReactNode } from "react";

afterEach(() => cleanup());

vi.mock("@/shell/mobile/MobileShellContext", () => ({
  useMobileShellContext: () => false,
}));
vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isAdmin: false,
    email: "tech@clinic.test",
    userId: "u1",
    role: "technician",
    effectiveRole: "technician",
    roleSource: "permanent",
  }),
}));
vi.mock("@/hooks/use-active-shift", () => ({
  useActiveShift: () => ({ hasActiveShift: true, isLoading: false, isError: false, nextShift: null }),
}));
vi.mock("@/hooks/use-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-sync")>();
  return {
    ...actual,
    usePendingSyncForEquipment: () => ({ rows: [], localState: "synced" }),
    useSyncQueue: () => ({ ...actual.useSyncQueue?.(), discard: vi.fn() }),
  };
});
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings: { soundEnabled: false, criticalAlertsSound: false } }),
}));
vi.mock("@/hooks/use-nfc-supported", () => ({
  useNfcSupported: () => ({ supported: false, loading: false }),
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
vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn() },
}));
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn() }));

// The full app chrome (Topbar, sidebar nav, dark-mode toggle, ...) is
// irrelevant to a mount-location defect scoped entirely to pageContent —
// stub it to a passthrough so the test doesn't have to also stand up the
// whole authenticated-shell dependency graph.
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Unrelated page-level panels — stubbed so this test stays scoped to the
// Dock-Return / RFID mount defect, not their own data fetching.
vi.mock("@/components/equipment/EquipmentTruthCard", () => ({
  EquipmentTruthCard: () => null,
}));
vi.mock("@/components/equipment/AssetCopilotPanel", () => ({
  AssetCopilotPanel: () => null,
}));
vi.mock("@/components/equipment/EquipmentDetailDetailsTab", () => ({
  EquipmentDetailDetailsTab: () => null,
}));

const equipmentGetMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        get: (...args: unknown[]) => equipmentGetMock(...args),
        logsPaginated: async () => ({ items: [], total: 0, page: 1, pageSize: 50, hasMore: false }),
        waitlist: async () => ({
          equipmentId: "eq1",
          queueSize: 0,
          myPosition: null,
          myStatus: null,
          reservationExpiresAt: null,
          notifiedUserId: null,
          entries: [],
        }),
        transfers: async () => [],
      },
      operationalState: {
        ...actual.api.operationalState,
        deployability: async () => ({
          equipmentId: "eq1",
          custodyState: "returned",
          readinessState: "unknown",
          usageState: "available",
          fullDeployable: false,
          bundleGate: { ok: true },
          asOfMs: Date.now(),
        }),
        listDocks: async () => [],
        listConditions: async () => [],
        conditionStates: async () => [],
      },
    },
  };
});

import EquipmentDetailPage from "@/pages/equipment-detail";

function baseEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq1",
    name: "Infusion Pump",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function renderDetailPage(equipment: Equipment) {
  equipmentGetMock.mockResolvedValue(equipment);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: `/equipment/${equipment.id}` });
  render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <Router hook={hook}>
          <Route path="/equipment/:id">
            <EquipmentDetailPage />
          </Route>
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
  // Wait for the initial equipment query to resolve past the loading skeleton.
  await screen.findByTestId("quick-action-bar");
}

describe("equipment-detail — Dock-Return + RFID sheets mount at page level (T-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Dock Return sheet renders from the DEFAULT (details) tab, not just the readiness tab", async () => {
    const equipment = baseEquipment({ custodyState: "returned", status: "ok" });
    await renderDetailPage(equipment);

    // Sanity: we're on the default tab — the readiness tab trigger exists,
    // but its panel is not the active one, and nothing from it is in the DOM.
    expect(screen.getByTestId("tab-readiness")).toBeTruthy();
    expect(screen.queryByText(t.dockReturn.title)).toBeNull();

    fireEvent.click(screen.getByTestId("btn-dock-return"));

    expect(await screen.findByText(t.dockReturn.title)).toBeTruthy();
  });

  it("RFID-attention tap opens the DockReturnNfc sheet from the DEFAULT (details) tab", async () => {
    const equipment = baseEquipment({
      custodyState: "checked_out",
      checkedOutById: "u1",
      checkedOutByEmail: "tech@clinic.test",
      checkedOutAt: new Date().toISOString(),
      lastRfidSeenAt: new Date().toISOString(),
      lastRfidRoomIsDock: true,
      lastRfidRoomName: "Dock A",
    });
    await renderDetailPage(equipment);

    expect(screen.getByTestId("equipment-detail-rfid-attention")).toBeTruthy();
    expect(screen.queryByText(t.dockReturn.nfcConfirmTitle)).toBeNull();

    fireEvent.click(screen.getByTestId("equipment-detail-rfid-attention"));

    expect(await screen.findByText(t.dockReturn.nfcConfirmTitle)).toBeTruthy();
  });
});
