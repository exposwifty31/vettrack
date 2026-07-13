/**
 * @vitest-environment happy-dom
 *
 * T-21 (R-EQ-07 · HIG debt · HIGH · Tier S) — the header controls in
 * src/pages/equipment-detail.tsx (btn-back, btn-duplicate, btn-edit,
 * btn-equipment-tools, btn-delete) render with `size="icon-sm"`
 * (`h-9 w-9` — 36px), under the Apple HIG ≥44pt touch-target minimum.
 *
 * jsdom has no layout engine, so `getBoundingClientRect()`/`getComputedStyle()`
 * can't assert real rendered pixels here. Instead this asserts the concrete
 * mechanism the fix introduces: each control carries the `h-11 w-11` (44px)
 * hit-area classes, matching the pattern already used on `btn-delete` in the
 * same header row — a transparent expanded touch target, not a bigger glyph.
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
// Admin so every header control (duplicate/edit/tools/delete) mounts.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isAdmin: true,
    email: "admin@clinic.test",
    userId: "u1",
    role: "admin",
    effectiveRole: "admin",
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

// The full app chrome is irrelevant to a header hit-area defect — stub it to
// a passthrough.
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Unrelated page-level panels — stubbed so this test stays scoped to the
// header touch-target defect, not their own data fetching.
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
        logsAdmin: async () => [],
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
  await screen.findByTestId("quick-action-bar");
}

// The ≥44pt hit-area mechanism this fix introduces: both the h-11 (2.75rem =
// 44px) and w-11 utility classes on the control itself.
function hasFortyFourPointHitArea(el: HTMLElement): boolean {
  return el.classList.contains("h-11") && el.classList.contains("w-11");
}

describe("equipment-detail — header controls meet the 44pt touch target (T-21 · R-EQ-07)", () => {
  it("btn-back, btn-duplicate, btn-edit, btn-equipment-tools, and btn-delete all carry the h-11 w-11 hit-area classes", async () => {
    const equipment = baseEquipment();
    await renderDetailPage(equipment);

    const testIds = [
      "btn-back",
      "btn-duplicate",
      "btn-edit",
      "btn-equipment-tools",
      "btn-delete",
    ];

    for (const testId of testIds) {
      const control = await screen.findByTestId(testId);
      expect(hasFortyFourPointHitArea(control), `${testId} is missing the h-11 w-11 hit-area classes`).toBe(true);
    }
  });
});
