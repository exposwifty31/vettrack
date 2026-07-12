/**
 * @vitest-environment happy-dom
 *
 * T-17 (R-EQ-03 · CLICK-PATH-012 · HIGH · Tier S) — in
 * src/pages/equipment-detail.tsx, the checkout path reads `useActiveShift()`
 * but previously ignored its `isError`, so a transient shift-query FAILURE
 * rendered identically to a *confirmed* off-shift state: the checkout
 * button was disabled client-side and the off-shift note shown, even though
 * the shift state is actually unknown (the query errored, it did not
 * resolve to "no active shift"). The fix defers to the server's
 * authoritative roster gate on a shift-query error instead of client-side
 * blocking — mirroring the fix already shipped in equipment-list.tsx
 * (`!shiftError && !hasActiveShift`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
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
// Transient shift-query FAILURE — distinct from a successful query that
// resolves to "no active shift". hasActiveShift is false only because the
// read never completed.
vi.mock("@/hooks/use-active-shift", () => ({
  useActiveShift: () => ({
    hasActiveShift: false,
    isLoading: false,
    isError: true,
    nextShift: null,
  }),
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

// The full app chrome is irrelevant to this defect, scoped entirely to the
// quick-action-bar checkout affordance — stub it to a passthrough.
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Unrelated page-level panels — stubbed so this test stays scoped to the
// shift-query-error defect, not their own data fetching.
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

describe("equipment-detail — checkout defers to server on shift-query error (T-17 · R-EQ-03)", () => {
  it("does not disable the checkout button, and does not show the off-shift note, when the shift query errors", async () => {
    // Not checked out, not a dock-return candidate — renders the plain
    // "btn-checkout" quick-action affordance.
    const equipment = baseEquipment();
    await renderDetailPage(equipment);

    const checkoutButton = (await screen.findByTestId("btn-checkout")) as HTMLButtonElement;
    expect(checkoutButton.disabled).toBe(false);
    expect(screen.queryByTestId("checkout-offshift-note")).toBeNull();
  });
});
