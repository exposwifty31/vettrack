/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 1 Step 3 — `/equipment` must serve two different bodies:
 * the mobile card list below the 1024px desktop breakpoint, and the dense
 * `EquipmentTable` console body at or above it. This asserts the branch itself
 * (which body mounts), not the table's internals — those are covered by
 * `equipment-table-desktop.test.tsx`.
 *
 * Harness mirrors `s11-equipment-list-chips-a11y.test.tsx`, which is the
 * existing precedent for mounting the whole page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Equipment } from "@/types";

const mockIsDesktop = vi.fn<() => boolean>();
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => mockIsDesktop() }));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin: true, userId: "u-1", effectiveRole: "admin", role: "admin", name: "A" }),
}));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    folders: { list: vi.fn(async () => []) },
    rooms: { list: vi.fn(async () => []) },
    alertAcks: { list: vi.fn(async () => []), acknowledge: vi.fn(), remove: vi.fn() },
    operationalState: { listDocks: vi.fn(async () => []) },
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

const { ROWS } = vi.hoisted(() => ({
  ROWS: [
    { id: "e1", name: "Ultrasound A", status: "ok", createdAt: "2026-08-01T08:00:00.000Z" },
    { id: "e2", name: "Infusion Pump", status: "ok", createdAt: "2026-08-01T08:00:00.000Z" },
  ] as Equipment[],
}));
vi.mock("@/hooks/use-paginated-equipment", () => ({
  usePaginatedEquipment: () => ({
    data: { items: ROWS, total: ROWS.length },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
  getPaginatedEquipmentQueryOptions: () => ({
    queryKey: ["/api/equipment", "paginated"],
    queryFn: async () => ({ items: ROWS, total: ROWS.length }),
  }),
}));

import EquipmentListPage from "@/pages/equipment-list";

function renderPage() {
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

afterEach(() => cleanup());

describe("/equipment — desktop renders the console table, narrow keeps the cards", () => {
  it("renders the dense table and no card list on desktop", () => {
    mockIsDesktop.mockReturnValue(true);
    renderPage();

    expect(document.querySelector("table")).toBeTruthy();
    expect(screen.queryByTestId("equipment-list")).toBeNull();
  });

  it("renders the card list and no table below the desktop breakpoint", () => {
    mockIsDesktop.mockReturnValue(false);
    renderPage();

    expect(screen.getByTestId("equipment-list")).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
  });
});
