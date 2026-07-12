/**
 * @vitest-environment happy-dom
 *
 * T-23e (R-EQ-F2 · small-02, mechanical fan-out) — <ReadinessBadge> (T-23d,
 * src/components/ui/readiness-badge.tsx) must be mounted on every
 * equipment-item render surface, fed from that item's own existing
 * `status: EquipmentStatus` field. Presence is asserted via the component's
 * own `data-readiness-tier` marker on the rendered glyph (see
 * readiness-badge.tsx:60-65) — never color alone.
 *
 * Surfaces covered here (one describe block each):
 *   1. src/pages/my-equipment.tsx
 *   2. src/pages/equipment-list.tsx (EquipmentItem row)
 *   3. src/pages/equipment-detail.tsx
 *   4. src/features/today/surfaces/floor/MyEquipmentCard.tsx — the shared
 *      child Vet/Tech/Student home surfaces render their equipment rows
 *      through (FloorHomeSurface is a pure archetype dispatcher onto these
 *      three; it never renders an equipment item directly).
 *   5. src/features/today/surfaces/RecentActivityCard.tsx — the only
 *      equipment-item render OpsHomeSurface has (CoverageCard/ExceptionsTile/
 *      ReadinessTile are aggregate stats, alert rows, and room rows — none
 *      carry an `EquipmentStatus`).
 *   6. src/features/command-board/CommandBoardScreen.tsx — the legacy
 *      ward-display fallback pane (`!board` branch). This is where the real
 *      `EquipmentStatus` survives to the client; the primary CommandBoard
 *      renders `EquipmentBoardUnitRow.status: EquipmentReadinessStatus`
 *      (shared/equipment-board.ts), a different, board-specific enum with no
 *      `EquipmentStatus` value in it at all. NOTE: the literal `src/board/*`
 *      directory (BoardShell/KioskAwake/BoardErrorBoundary/useBoardAutoReload)
 *      is kiosk chrome only and renders no equipment items.
 *
 * NOT covered (deliberately, see the T-23e report for detail):
 *   - src/features/equipment/LocateSearch.tsx — `EquipmentLocateResult`
 *     (src/types/locate.ts) carries only a formatted `readiness: string`
 *     (readinessState-derived — server/routes/equipment-locate.ts:90), never
 *     the raw `EquipmentStatus` ReadinessBadge requires. Mounting there would
 *     mean either a type error or inventing a status the server never sent —
 *     out of scope for a mechanical, no-logic-change fan-out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import type { ReactNode } from "react";
import type { Equipment, ActivityFeedItem, DisplaySnapshot } from "@/types";

afterEach(() => cleanup());

function readinessTiers(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-readiness-tier]")).map(
    (el) => el.getAttribute("data-readiness-tier") ?? "",
  );
}

// ---------------------------------------------------------------------------
// Shared mocks — one file-level vi.mock per module (Vitest hoists these; a
// module can only be mocked once per file), unioned across every surface's
// needs. Individual surfaces below only add what's unique to them.
// ---------------------------------------------------------------------------
const { equipmentListMyMock, equipmentGetMock, useDisplaySnapshotMock } = vi.hoisted(() => ({
  equipmentListMyMock: vi.fn(async () => [] as unknown[]),
  equipmentGetMock: vi.fn(),
  useDisplaySnapshotMock: vi.fn(),
}));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    userId: "u1",
    isAdmin: false,
    name: "Test User",
    email: "user@test.clinic",
    role: "vet_tech",
    effectiveRole: "vet_tech",
    roleSource: "permanent",
  }),
}));
vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn() },
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
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn() }));
vi.mock("@/shell/mobile/MobileShellContext", () => ({
  useMobileShellContext: () => false,
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
  useSettings: () => ({ settings: { soundEnabled: false, criticalAlertsSound: false, density: "comfortable" } }),
}));
vi.mock("@/hooks/use-nfc-supported", () => ({
  useNfcSupported: () => ({ supported: false, loading: false }),
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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        listMy: equipmentListMyMock,
        get: equipmentGetMock,
        logsPaginated: async () => ({ items: [], total: 0, page: 1, pageSize: 50, hasMore: false }),
        logsAdmin: async () => [],
        waitlist: async () => ({
          equipmentId: "eq-detail-1",
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
          equipmentId: "eq-detail-1",
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

// Board-only mocks — sidestep the real SSE/EventSource plumbing entirely.
vi.mock("@/hooks/useDisplaySnapshot", () => ({
  useDisplaySnapshot: useDisplaySnapshotMock,
}));
vi.mock("@/hooks/useDisplayHeartbeat", () => ({ useDisplayHeartbeat: () => {} }));
vi.mock("@/hooks/useRealtimeReconciliation", () => ({ useRealtimeReconciliation: () => {} }));
vi.mock("@/hooks/useCodeBlueKeepaliveReconciliation", () => ({
  useCodeBlueKeepaliveReconciliation: () => {},
}));
vi.mock("@/lib/realtime", () => ({
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
  EventIngestor: class {
    getLastAppliedEventId() {
      return null;
    }
    replayHttpCatchUpAfter() {
      return Promise.resolve();
    }
    dispose() {}
  },
  publishBuildTagGossip: vi.fn(),
  publishCodeBlueSeenGossip: vi.fn(),
}));

import MyEquipmentPage from "@/pages/my-equipment";
import { EquipmentItem } from "@/pages/equipment-list";
import EquipmentDetailPage from "@/pages/equipment-detail";
import { MyEquipmentCard } from "@/features/today/surfaces/floor/MyEquipmentCard";
import { RecentActivityCard } from "@/features/today/surfaces/RecentActivityCard";
import CommandBoardScreen from "@/features/command-board/CommandBoardScreen";

function withQuery(node: ReactNode, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <Router hook={hook}>{node}</Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("ReadinessBadge fan-out — my-equipment.tsx", () => {
  it("renders a ReadinessBadge for each checked-out item, keyed off its own status", async () => {
    equipmentListMyMock.mockResolvedValueOnce([
      {
        id: "eq-my-1",
        name: "Otoscope",
        status: "critical",
        createdAt: "2026-01-01T00:00:00.000Z",
        checkedOutAt: "2026-01-01T00:00:00.000Z",
      } satisfies Equipment,
    ]);
    const { container } = withQuery(<MyEquipmentPage />, "/my-equipment");
    await screen.findByText("Otoscope");
    expect(readinessTiers(container)).toContain("not_ready");
  });
});

describe("ReadinessBadge fan-out — equipment-list.tsx (EquipmentItem row)", () => {
  it("renders a ReadinessBadge fed from the row's own equipment status", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const equipment = { id: "eq-list-1", name: "Vetscan VS2", status: "critical", checkedOutById: null } as Equipment;
    const { container } = render(
      <QueryClientProvider client={qc}>
        <EquipmentItem
          equipment={equipment}
          selectMode={false}
          selected={false}
          onToggleSelect={() => {}}
          hasActiveShift
          shiftLoading={false}
          shiftError={false}
        />
      </QueryClientProvider>,
    );
    expect(readinessTiers(container)).toContain("not_ready");
  });
});

describe("ReadinessBadge fan-out — equipment-detail.tsx", () => {
  it("renders a ReadinessBadge for the detail page's own equipment status", async () => {
    equipmentGetMock.mockResolvedValueOnce({
      id: "eq-detail-1",
      name: "Infusion Pump",
      status: "critical",
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies Equipment);
    const { container } = withQuery(
      <Route path="/equipment/:id">
        <EquipmentDetailPage />
      </Route>,
      "/equipment/eq-detail-1",
    );
    await screen.findByTestId("quick-action-bar");
    expect(readinessTiers(container)).toContain("not_ready");
  });
});

describe("ReadinessBadge fan-out — MyEquipmentCard (shared by Vet/Tech/Student home surfaces)", () => {
  it("renders a ReadinessBadge per row alongside the existing readiness chip", () => {
    const items: Equipment[] = [
      { id: "eq-card-1", name: "Otoscope", status: "critical", createdAt: "2026-07-01T00:00:00.000Z" },
    ];
    const { hook } = memoryLocation({ path: "/home" });
    const { container } = render(
      <Router hook={hook}>
        <MyEquipmentCard items={items} isLoading={false} />
      </Router>,
    );
    expect(readinessTiers(container)).toContain("not_ready");
  });
});

describe("ReadinessBadge fan-out — RecentActivityCard (OpsHomeSurface's only equipment-item render)", () => {
  it("renders a ReadinessBadge for a feed row that carries a status", () => {
    const items: ActivityFeedItem[] = [
      {
        id: "act-1",
        type: "scan",
        equipmentId: "eq-act-1",
        equipmentName: "Otoscope",
        status: "critical",
        userId: "u1",
        userEmail: "user@test.clinic",
        timestamp: "2026-07-01T00:00:00.000Z",
      },
    ];
    const { hook } = memoryLocation({ path: "/home" });
    const { container } = render(
      <Router hook={hook}>
        <RecentActivityCard items={items} isLoading={false} currentUserId="u1" />
      </Router>,
    );
    expect(readinessTiers(container)).toContain("not_ready");
  });

  it("does not render a ReadinessBadge for a row with no status (optional field, no fabrication)", () => {
    const items: ActivityFeedItem[] = [
      {
        id: "act-2",
        type: "created",
        equipmentId: "eq-act-2",
        equipmentName: "New Otoscope",
        userId: "u1",
        userEmail: "user@test.clinic",
        timestamp: "2026-07-01T00:00:00.000Z",
      },
    ];
    const { hook } = memoryLocation({ path: "/home" });
    const { container } = render(
      <Router hook={hook}>
        <RecentActivityCard items={items} isLoading={false} currentUserId="u1" />
      </Router>,
    );
    expect(readinessTiers(container)).toHaveLength(0);
  });
});

describe("ReadinessBadge fan-out — CommandBoardScreen board fallback pane", () => {
  it("renders a ReadinessBadge per equipment row in the legacy ward-display fallback (commandBoard unavailable)", async () => {
    useDisplaySnapshotMock.mockReturnValue({
      currentTime: new Date().toISOString(),
      currentShift: [],
      hospitalizations: [],
      equipment: [
        {
          id: "eq-board-1",
          name: "Defibrillator",
          status: "critical",
          inUse: false,
          heldBy: null,
          lastCheckInAt: null,
          probableLocation: null,
          isDeployable: false,
          custodyState: "docked",
          readinessState: "not_ready",
          usageState: "available",
        },
      ],
      upcomingTasks: [],
      overdueTasks: [],
      activeAlertCount: 0,
      totalOverdueCount: 0,
      crashCartStatus: null,
      codeBlueSession: null,
      commandBoard: null,
    } satisfies DisplaySnapshot);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <CommandBoardScreen />
      </QueryClientProvider>,
    );
    await screen.findByTestId("ward-display-equipment-pane");
    expect(readinessTiers(container)).toContain("not_ready");
  });

  it("does not crash on a status outside the known EquipmentStatus union — renders the not_ready tier instead", async () => {
    useDisplaySnapshotMock.mockReturnValue({
      currentTime: new Date().toISOString(),
      currentShift: [],
      hospitalizations: [],
      equipment: [
        {
          id: "eq-board-2",
          name: "Legacy Monitor",
          // Not one of the six EquipmentStatus literals — e.g. stale data from
          // a pre-migration row or a future value this client doesn't know yet.
          status: "unrecognized_legacy_value",
          inUse: false,
          heldBy: null,
          lastCheckInAt: null,
          probableLocation: null,
          isDeployable: false,
          custodyState: "docked",
          readinessState: "unknown",
          usageState: "available",
        },
      ],
      upcomingTasks: [],
      overdueTasks: [],
      activeAlertCount: 0,
      totalOverdueCount: 0,
      crashCartStatus: null,
      codeBlueSession: null,
      commandBoard: null,
    } satisfies DisplaySnapshot);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <CommandBoardScreen />
      </QueryClientProvider>,
    );
    await screen.findByTestId("ward-display-equipment-pane");
    // Fails cautious — an unrecognized status must never render as "ready".
    expect(readinessTiers(container)).toContain("not_ready");
  });
});
