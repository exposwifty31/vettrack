/**
 * @vitest-environment happy-dom
 *
 * D4 client half — an admin returning a unit HELD BY SOMEONE ELSE must send
 * `force: true`, because the server's holder guard
 * (`allowForeignHolder = isAdmin && force === true`, equipment.ts) refuses a
 * foreign return without it. The web already SHOWS the button to admins
 * (`checkedOutByMe || isAdmin`), so shipping the guard without this body flag
 * turns end-of-day recovery into a 403 on every press.
 *
 * The mirror case matters as much: an admin returning their OWN unit must NOT
 * send force — `force` is what stamps `forcedByAdmin: true` into the audit
 * record, and a routine self-return must not read as a supervisor override.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import type { Equipment } from "@/types";
import type { ReactNode } from "react";

afterEach(() => {
  cleanup();
});

const { authState } = vi.hoisted(() => ({
  authState: {
    isAdmin: true,
    email: "admin@clinic.test",
    userId: "admin-1",
    role: "admin",
    effectiveRole: "admin",
    roleSource: "permanent",
  },
}));

vi.mock("@/shell/mobile/MobileShellContext", () => ({
  useMobileShellContext: () => false,
}));
vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
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

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn() }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
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
const returnMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        get: (...args: unknown[]) => equipmentGetMock(...args),
        return: (...args: unknown[]) => returnMock(...args),
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
          custodyState: "checked_out",
          readinessState: "unknown",
          usageState: "in_use",
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

function heldEquipment(holderId: string | null, holderEmail: string | null): Equipment {
  return {
    id: "eq1",
    name: "Infusion Pump",
    status: "ok",
    checkedOutById: holderId,
    checkedOutByEmail: holderEmail,
    checkedOutAt: new Date().toISOString(),
    createdAt: "2026-01-01T00:00:00.000Z",
    custodyState: "checked_out",
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
  await screen.findByTestId("quick-action-bar");
}

async function confirmPluggedInReturn() {
  fireEvent.click(screen.getByTestId("btn-return"));
  fireEvent.click(await screen.findByTestId("btn-plugged-yes"));
  fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));
  await waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
}

describe("admin return of a unit held by someone else (D4 client half)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    returnMock.mockResolvedValue({
      equipment: { id: "eq1", name: "Infusion Pump", status: "ok", checkedOutById: null },
      undoToken: "tok",
    });
  });

  it("sends force: true, which the server's holder guard requires from an admin", async () => {
    await renderDetailPage(heldEquipment("other-user", "tech@clinic.test"));
    await confirmPluggedInReturn();
    expect(returnMock).toHaveBeenCalledWith("eq1", expect.objectContaining({ force: true }));
  });

  it("does NOT send force when the admin returns their own unit — a routine self-return must not read as forcedByAdmin in the audit record", async () => {
    await renderDetailPage(heldEquipment("admin-1", "admin@clinic.test"));
    await confirmPluggedInReturn();
    expect(returnMock).toHaveBeenCalledWith(
      "eq1",
      expect.not.objectContaining({ force: expect.anything() }),
    );
  });

  it("offers an admin the return on an ORPHANED checked_out row (null holder) and sends force", async () => {
    await renderDetailPage(heldEquipment(null, null));
    await confirmPluggedInReturn();
    expect(returnMock).toHaveBeenCalledWith("eq1", expect.objectContaining({ force: true }));
  });

  it("a NON-admin viewing a foreign holder's unit gets NO return affordance at all", async () => {
    authState.isAdmin = false;
    authState.role = "technician";
    authState.userId = "tech-2";
    authState.effectiveRole = "technician";
    try {
      await renderDetailPage(heldEquipment("other-user", "tech@clinic.test"));
      expect(screen.queryByTestId("btn-return")).toBeNull();
      expect(screen.queryByTestId("btn-scan-action-return")).toBeNull();
      expect(returnMock).not.toHaveBeenCalled();
    } finally {
      authState.isAdmin = true;
      authState.role = "admin";
      authState.userId = "admin-1";
      authState.effectiveRole = "admin";
    }
  });
});
