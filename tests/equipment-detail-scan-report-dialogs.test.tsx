/**
 * @vitest-environment happy-dom
 *
 * Coverage for the equipment-detail "Update Status" and "Report Issue"
 * dialogs after their extraction into
 * src/features/equipment-detail/{EquipmentScanStatusDialog,EquipmentReportIssueDialog}.tsx
 * (god-file split slice — see docs/architecture/equipment-god-files-split-plan.md).
 *
 * The extraction moved JSX only: state, mutations, and validation stayed on
 * src/pages/equipment-detail.tsx and are passed down as controlled props.
 * This test drives both dialogs end-to-end through the composed page to
 * prove the prop wiring (open/close, status selection, note validation,
 * submit) still behaves identically after the move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Unrelated page-level panels — stubbed so this test stays scoped to the two
// extracted dialogs, not their own data fetching.
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
const scanMock = vi.fn();

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
        scan: (...args: unknown[]) => scanMock(...args),
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
  await screen.findByTestId("quick-action-bar");
  return { client };
}

describe("EquipmentScanStatusDialog (extracted) — status scan flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanMock.mockResolvedValue({
      equipment: baseEquipment({ status: "issue" }),
      scanLog: { id: "log-1", note: "Leaking fluid" },
      undoToken: "undo-1",
    });
  });

  it("opens from btn-scan and submits the selected status + note", async () => {
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-scan"));
    expect(await screen.findByTestId("btn-confirm-scan")).toBeTruthy();

    fireEvent.click(screen.getByTestId("scan-status-issue"));
    fireEvent.change(screen.getByTestId("scan-note"), { target: { value: "Leaking fluid" } });
    fireEvent.click(screen.getByTestId("btn-confirm-scan"));

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(scanMock).toHaveBeenCalledWith(
      "eq1",
      expect.objectContaining({ status: "issue", note: "Leaking fluid" }),
    );
  });

  it("blocks submit with an inline error when status=issue has no note, and never calls the API", async () => {
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-scan"));
    fireEvent.click(await screen.findByTestId("scan-status-issue"));
    fireEvent.click(screen.getByTestId("btn-confirm-scan"));

    expect(await screen.findByText("A note is required when reporting an issue.")).toBeTruthy();
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("closes the dialog on Cancel without submitting", async () => {
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-scan"));
    await screen.findByTestId("btn-confirm-scan");
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByTestId("btn-confirm-scan")).toBeNull());
    expect(scanMock).not.toHaveBeenCalled();
  });
});

describe("EquipmentReportIssueDialog (extracted) — report-issue flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanMock.mockResolvedValue({
      equipment: baseEquipment({ status: "issue" }),
      scanLog: { id: "log-2", note: "Won't power on" },
      undoToken: "undo-2",
    });
  });

  it("opens from btn-report-issue and submits status=issue with the entered note", async () => {
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-report-issue"));
    fireEvent.change(await screen.findByTestId("report-issue-note"), {
      target: { value: "Won't power on" },
    });
    fireEvent.click(screen.getByTestId("btn-confirm-report-issue"));

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(scanMock).toHaveBeenCalledWith(
      "eq1",
      expect.objectContaining({ status: "issue", note: "Won't power on" }),
    );
  });

  it("closes the dialog on Cancel without submitting", async () => {
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-report-issue"));
    await screen.findByTestId("btn-confirm-report-issue");
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByTestId("btn-confirm-report-issue")).toBeNull());
    expect(scanMock).not.toHaveBeenCalled();
  });
});
