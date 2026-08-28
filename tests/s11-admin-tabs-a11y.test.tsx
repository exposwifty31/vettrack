/**
 * @vitest-environment happy-dom
 *
 * S11.1 — admin.tsx tab strip. The hand-rolled strip had no tab semantics at
 * all (6 plain <button>s, no tablist/tab/tabpanel, no aria-selected, no
 * arrow-key navigation); Radix Tabs supplies all of it. Assertions read the
 * LIVE DOM, never the source diff.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

vi.mock("@/pages/admin/FoldersSection", () => ({
  FoldersSection: () => <div data-testid="section-folders" />,
}));
vi.mock("@/pages/admin/PendingUsersSection", () => ({
  PendingUsersSection: () => <div data-testid="section-pending" />,
}));
vi.mock("@/pages/admin/UsersSection", () => ({
  UsersSection: () => <div data-testid="section-users" />,
}));
vi.mock("@/pages/admin/DeletedItemsSection", () => ({
  DeletedItemsSection: () => <div data-testid="section-deleted" />,
}));
vi.mock("@/pages/admin/SupportSection", () => ({
  SupportSection: () => <div data-testid="section-support" />,
}));
vi.mock("@/features/shift-adjustments/AdminShiftRequestsSection", () => ({
  AdminShiftRequestsSection: () => <div data-testid="section-shift-requests" />,
}));

import AdminPage from "@/pages/admin";

function renderAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <Router hook={memoryLocation({ path: "/admin" }).hook}>
          <AdminPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

afterEach(() => cleanup());

const ADMIN_TAB_TESTIDS = [
  "admin-tab-folders",
  "admin-tab-pending",
  "admin-tab-users",
  "admin-tab-support",
  "admin-tab-shift-requests",
  "admin-tab-deleted",
];

describe("S11.1 — admin tab strip exposes real tab semantics", () => {
  it("renders a single tablist", () => {
    renderAdmin();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("every tab button carries role=tab and keeps its data-testid", () => {
    renderAdmin();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(ADMIN_TAB_TESTIDS.length);
    expect(tabs.map((el) => el.getAttribute("data-testid"))).toEqual(ADMIN_TAB_TESTIDS);
  });

  it("exposes the selected tab via aria-selected, not colour alone", () => {
    renderAdmin();
    const selected = screen
      .getAllByRole("tab")
      .filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-testid")).toBe("admin-tab-folders");
  });

  it("renders the active section inside a tabpanel wired to its tab", () => {
    renderAdmin();
    const panel = screen.getByRole("tabpanel");
    const selectedTab = screen.getByRole("tab", { selected: true });
    expect(panel.getAttribute("aria-labelledby")).toBe(selectedTab.id);
    expect(selectedTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.querySelector('[data-testid="section-folders"]')).toBeTruthy();
  });

  it("uses a roving tabindex so the strip is ONE tab stop, not six", () => {
    renderAdmin();
    // Radix Tabs puts the roving tabindex on the triggers: once focus enters
    // the strip, the active tab is the single tab stop and the rest are
    // skipped. Six sequentially-tabbable buttons is what this replaces.
    const tabs = screen.getAllByRole("tab");
    const selected = screen.getByRole("tab", { selected: true });
    fireEvent.focus(selected);
    expect(selected.getAttribute("tabindex")).toBe("0");
    for (const tab of tabs) {
      if (tab === selected) continue;
      expect(tab.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("moves between tabs with the arrow keys", async () => {
    renderAdmin();
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });

    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-testid")).toBe("admin-tab-pending"),
    );
    expect(
      screen.getByTestId("admin-tab-pending").getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel").querySelector('[data-testid="section-pending"]')).toBeTruthy();
  });
});
