/**
 * @vitest-environment happy-dom
 *
 * T-24d (R-EQ-F3 · small-04 · Tier S) — "Returned damaged" third choice in
 * ReturnPlugDialog + undo, wired at the equipment-detail.tsx return call
 * site.
 *
 * OWNER override (2026-07-13): picking "Damaged" and confirming now releases
 * custody immediately, exactly like the other two return choices —
 * `api.equipment.return` fires right away. Only the damage report itself
 * stays deferred behind the same `UNDO_WINDOW_MS` undo toast used elsewhere
 * in this file: if the user never hits Undo, `reportDamage` fires once the
 * window elapses; if the user hits Undo within the window, the report never
 * fires at all (no revert/cancel endpoint exists server-side for damage
 * events — the only safe "undo" is not having submitted yet). Undoing the
 * damage report does not revert the return — custody stays released. Only
 * one undo toast is shown for the gesture (the damage-report one); the
 * return's own "returned" undo toast is suppressed to avoid a confusing
 * double undo affordance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import type { Equipment } from "@/types";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

const { toastMock, hapticsWarningMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
  hapticsWarningMock: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn(), warning: (...a: unknown[]) => hapticsWarningMock(...a) },
}));
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn() }));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Unrelated page-level panels — stubbed so this test stays scoped to the
// return + damage-report wiring, not their own data fetching.
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
const reportDamageMock = vi.fn();
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
        reportDamage: (...args: unknown[]) => reportDamageMock(...args),
        return: (...args: unknown[]) => returnMock(...args),
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

function baseEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq1",
    name: "Infusion Pump",
    status: "ok",
    checkedOutById: "u1",
    checkedOutByEmail: "tech@clinic.test",
    checkedOutAt: new Date().toISOString(),
    createdAt: "2026-01-01T00:00:00.000Z",
    custodyState: "checked_out",
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

describe("ReturnPlugDialog — 'Returned damaged' third choice + undo (T-24d)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportDamageMock.mockResolvedValue({
      damageEvent: { id: "dmg-1", equipmentId: "eq1", reportedBy: "u1", at: new Date().toISOString(), note: null },
      conditionStatus: "damaged",
    });
  });

  it("shows the third 'Damaged' choice on the equipment-detail return dialog", async () => {
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-return"));

    expect(screen.getByTestId("btn-returned-damaged")).toBeTruthy();
  });

  // F-3 (device audit 2026-07-13): a normal return must refresh the
  // evidence-graph custodian summary (EquipmentTruthCard reads the
  // ["equipment-truth", id] query). invalidateAll() previously omitted it,
  // so the "אחראי" custodian text stayed stale after a return.
  it("invalidates the equipment-truth query on a normal return (F-3)", async () => {
    returnMock.mockResolvedValue({
      equipment: {
        ...baseEquipment(),
        custodyState: "available",
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
      },
      undoToken: "undo-normal",
    });
    const { client } = await renderDetailPage(baseEquipment());
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByTestId("btn-return"));
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await waitFor(() => expect(returnMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["equipment-truth", "eq1"] }),
      ),
    );
  });

  it("releases custody immediately on confirm — only the damage report is deferred until the undo window elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    returnMock.mockResolvedValue({
      equipment: {
        ...baseEquipment(),
        custodyState: "available",
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
      },
      undoToken: "undo-1",
    });
    const { client } = await renderDetailPage(baseEquipment());
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByTestId("btn-return"));
    fireEvent.click(screen.getByTestId("btn-returned-damaged"));
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    // Custody release is not deferred — it fires as soon as the return
    // choice is confirmed, same as the other two return choices.
    await vi.waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));
    expect(returnMock).toHaveBeenCalledWith("eq1", expect.objectContaining({ isPluggedIn: true }));
    expect(reportDamageMock).not.toHaveBeenCalled();
    expect(hapticsWarningMock).toHaveBeenCalledTimes(1);

    // Exactly one undo affordance for this gesture — the damage-report
    // undo toast. returnMut's own "returned" undo toast must be suppressed
    // here, or the user would see two competing undo toasts for one tap.
    const actionToasts = toastMock.mock.calls.filter(
      (call) => (call[1] as { action?: unknown } | undefined)?.action,
    );
    expect(actionToasts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(reportDamageMock).toHaveBeenCalledTimes(1);
    expect(reportDamageMock).toHaveBeenCalledWith(expect.objectContaining({ equipmentId: "eq1" }));
    // Readiness caches must refresh after the condition flip or the
    // equipment-truth/readiness tab can stay stale.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["deployability", "eq1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["condition-states", "eq1"] });
  });

  it("undo within the window cancels only the damage report — custody stays released and reportDamage is never called", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    returnMock.mockResolvedValue({
      equipment: {
        ...baseEquipment(),
        custodyState: "available",
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
      },
      undoToken: "undo-1",
    });
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-return"));
    fireEvent.click(screen.getByTestId("btn-returned-damaged"));
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await vi.waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));

    const undoCall = toastMock.mock.calls.find(
      (call) => (call[1] as { action?: { label?: string } } | undefined)?.action?.label,
    );
    expect(undoCall).toBeTruthy();
    // Non-null: the toBeTruthy() above is a runtime check only — TypeScript
    // can't narrow `undoCall` (an Array.find result) past it.
    const options = undoCall![1] as { action: { onClick: () => void } };
    options.action.onClick();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(reportDamageMock).not.toHaveBeenCalled();
    // Undo only cancels the deferred damage report — it does not revert the
    // return. Custody stays released, matching how a normal return isn't
    // casually reverted by this same gesture.
    expect(returnMock).toHaveBeenCalledTimes(1);
  });

  it("when the return itself was queued OFFLINE, never fires the online-only reportDamage — surfaces an offline message instead (CodeRabbit Major)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    returnMock.mockResolvedValue({
      equipment: {
        ...baseEquipment(),
        custodyState: "available",
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
      },
      undoToken: undefined,
      pendingSyncId: 42,
    });
    await renderDetailPage(baseEquipment());

    fireEvent.click(screen.getByTestId("btn-return"));
    fireEvent.click(screen.getByTestId("btn-returned-damaged"));
    fireEvent.click(screen.getByTestId("btn-confirm-return-plug"));

    await vi.waitFor(() => expect(returnMock).toHaveBeenCalledTimes(1));

    // Let the undo window (that would normally fire the deferred damage
    // report) fully elapse.
    await vi.advanceTimersByTimeAsync(15_000);

    // The return was queued offline — the damage report must never be
    // attempted, or it silently fails against the network (data loss: the
    // return is queued but the damage report is dropped).
    expect(reportDamageMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(t.equipmentDetail.toast.damageReportOffline);
  });
});
