/**
 * @vitest-environment happy-dom
 *
 * S11.2 — equipment-list.tsx: the status + recovery filter chips are toggles
 * that announced no pressed state. Assertions read the LIVE DOM.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin: true, userId: "u-1", effectiveRole: "admin", role: "admin", name: "A" }),
}));

const { analyticsSummary } = vi.hoisted(() => ({
  analyticsSummary: {
    maintenanceComplianceRate: 91,
    sterilizationComplianceRate: 88,
    statusBreakdown: { ok: 12, issue: 3, maintenance: 2, sterilized: 4, overdue: 1 },
    // 14 buckets with real counts → the bar chart renders instead of its empty state.
    scanActivity: Array.from({ length: 14 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      count: i + 1,
    })),
    // Empty → the "top problem equipment" EmptyState renders (the heading-level case).
    topProblemEquipment: [],
    readiness: null,
    occupancy: null,
    taskOnTime: null,
    perRoom: [],
  },
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    analytics: {
      summary: vi.fn(async () => analyticsSummary),
      readinessForecast: vi.fn(async () => null),
    },
    support: { unresolvedCount: vi.fn(async () => ({ count: 0 })) },
    users: { listPending: vi.fn(async () => []), me: vi.fn(async () => ({})) },
    shiftAdjustments: { list: vi.fn(async () => []) },
    folders: { list: vi.fn(async () => []) },
    rooms: { list: vi.fn(async () => []) },
    alertAcks: { list: vi.fn(async () => []), acknowledge: vi.fn(), remove: vi.fn() },
    equipment: {
      list: vi.fn(async () => []),
      bulkDelete: vi.fn(async () => ({})),
      bulkMove: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/shell/mobile/MobileShellContext", () => ({
  useMobileShellContext: () => false,
  MobileShellContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));
vi.mock("@/lib/equipment-recovery-ui-flag", () => ({ isEquipmentRecoveryUiEnabled: true }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("@/hooks/use-sync", () => ({ useSync: () => ({ items: [] }) }));
vi.mock("@/hooks/use-active-shift", () => ({
  useActiveShift: () => ({ hasActiveShift: true, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-paginated-equipment", () => ({
  usePaginatedEquipment: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
  getPaginatedEquipmentQueryOptions: () => ({ queryKey: ["/api/equipment", "paginated"], queryFn: async () => ({ items: [], total: 0 }) }),
}));

afterEach(() => cleanup());

import EquipmentListPage from "@/pages/equipment-list";

function renderEquipmentList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <Router hook={memoryLocation({ path: "/equipment" }).hook}>
          <EquipmentListPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("S11.2 — equipment filter chips announce their pressed state", () => {
  it("every status chip exposes aria-pressed, and exactly the active one is pressed", () => {
    renderEquipmentList();
    const chips = Array.from(
      screen.getByTestId("status-filter-chips").querySelectorAll('[data-testid^="status-chip-"]'),
    );
    expect(chips.length).toBeGreaterThan(1);
    for (const chip of chips) {
      expect(chip.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
    }
    const pressed = chips.filter((c) => c.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    // No ?status= in the URL → the "all" chip is the active filter.
    expect(pressed[0].getAttribute("data-testid")).toBe("status-chip-all");
  });

  it("the recovery-attention chip exposes aria-pressed and toggles it on click", () => {
    renderEquipmentList();
    const chip = screen.getByTestId("recovery-attention-filter");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(screen.getByTestId("recovery-attention-filter").getAttribute("aria-pressed")).toBe("true");
  });
});
