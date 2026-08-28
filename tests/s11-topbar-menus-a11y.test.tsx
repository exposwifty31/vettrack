/**
 * @vitest-environment happy-dom
 *
 * S11.5–7 — the Topbar and its two dropdowns. aria-haspopup="true" maps to
 * "menu", but neither popup is a menu (they are links / toggles): the honest
 * pattern is a disclosure (aria-expanded + aria-controls). And two navigation
 * landmarks need two distinct names. Assertions read the LIVE DOM.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

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

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: { locale: "he", density: "comfortable" },
    update: vi.fn(),
  }),
  useIsDarkActive: () => false,
}));

vi.mock("@/hooks/use-experience", () => ({ useExperience: () => ({ role: "admin" }) }));
vi.mock("@/lib/roles/experience-model", () => ({
  visibleNavItems: () => [
    { id: "nav-today", href: "/home", labelKey: "nav.today" },
    { id: "nav-equipment", href: "/equipment", labelKey: "nav.equipment" },
  ],
}));
vi.mock("@/lib/routes/web-management-nav-model", () => ({
  visibleWebManagementNav: () => MGMT_ITEMS,
}));
vi.mock("@/components/alerts-dropdown", () => ({
  AlertsDropdown: () => <button type="button">alerts</button>,
}));
vi.mock("@/components/layout/TopbarSearch", () => ({
  TopbarSearch: () => <div data-testid="topbar-search" />,
}));

afterEach(() => cleanup());

import { TopbarManagementMenu } from "@/components/layout/TopbarManagementMenu";

const MGMT_ITEMS = [
  { id: "mgmt-integrations", href: "/admin/integrations", labelKey: "nav.integrations" },
  { id: "mgmt-people", href: "/admin/people", labelKey: "nav.people" },
];

function renderManagementMenu() {
  return render(
    <Router hook={memoryLocation({ path: "/admin/people" }).hook}>
      <TopbarManagementMenu items={MGMT_ITEMS} activeHref="/admin/people" />
    </Router>,
  );
}

describe("S11.5 — the management dropdown stops claiming to be a menu", () => {
  it("does not promise a menu popup it never renders", () => {
    renderManagementMenu();
    const trigger = screen.getByRole("button", { name: new RegExp(t.nav.management) });
    // aria-haspopup="true" is the ARIA alias for "menu"; the popup is a list of
    // links, so the attribute told assistive tech to expect menu semantics
    // (arrow keys, role=menuitem) that do not exist here.
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // And nothing anywhere in this component re-declares a menu.
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("points aria-controls at the panel that actually exists, only while it exists", () => {
    const { container } = renderManagementMenu();
    const trigger = screen.getByRole("button", { name: new RegExp(t.nav.management) });

    // Closed: no dangling IDREF.
    const closedControls = trigger.getAttribute("aria-controls");
    if (closedControls) {
      expect(container.ownerDocument.getElementById(closedControls)).toBeNull();
    }

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const controls = trigger.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const panel = container.ownerDocument.getElementById(controls!);
    expect(panel).toBeTruthy();
    expect(panel!.querySelectorAll("a").length).toBe(MGMT_ITEMS.length);
  });

  it("exposes the open panel as a named navigation landmark", () => {
    renderManagementMenu();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.nav.management) }));
    const landmark = screen.getByRole("navigation", { name: t.nav.management });
    expect(landmark.querySelectorAll("a").length).toBe(MGMT_ITEMS.length);
  });
});

import { TopbarSettingsMenu } from "@/components/layout/TopbarSettingsMenu";

function renderSettingsMenu() {
  return render(
    <Router hook={memoryLocation({ path: "/home" }).hook}>
      <TopbarSettingsMenu />
    </Router>,
  );
}

describe("S11.6 — the settings dropdown stops claiming to be a menu", () => {
  it("does not promise a menu popup it never renders", () => {
    renderSettingsMenu();
    const trigger = screen.getByRole("button", { name: t.nav.settings });
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("points aria-controls at the panel that actually exists, only while it exists", () => {
    const { container } = renderSettingsMenu();
    const trigger = screen.getByRole("button", { name: t.nav.settings });

    const closedControls = trigger.getAttribute("aria-controls");
    if (closedControls) {
      expect(container.ownerDocument.getElementById(closedControls)).toBeNull();
    }

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const controls = trigger.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const panel = container.ownerDocument.getElementById(controls!);
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain(t.nav.quickSettings);
  });

  it("stays out of the navigation-landmark budget — it is toggles, not links", () => {
    renderSettingsMenu();
    fireEvent.click(screen.getByRole("button", { name: t.nav.settings }));
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
  });

  it("gives the focused panel a name a screen reader can actually read", () => {
    // The panel takes focus on open (panelRef.current?.focus()). aria-label on a
    // role-less generic element computes no accessible name, so the focus landed
    // on something nameless; a container role is what makes the label real.
    renderSettingsMenu();
    fireEvent.click(screen.getByRole("button", { name: t.nav.settings }));
    expect(screen.getByRole("group", { name: t.nav.quickSettings })).toBeTruthy();
  });
});

import { Topbar } from "@/components/layout/Topbar";

function renderTopbar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={memoryLocation({ path: "/equipment" }).hook}>
        <Topbar />
      </Router>
    </QueryClientProvider>,
  );
}

describe("S11.7 — every navigation landmark in the Topbar is named", () => {
  it("names the primary operational nav strip", () => {
    renderTopbar();
    const navs = screen.getAllByRole("navigation");
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) {
      const name = nav.getAttribute("aria-label") ?? nav.getAttribute("aria-labelledby");
      expect(name?.trim()).toBeTruthy();
    }
  });

  it("gives the primary strip and the management panel different names", () => {
    renderTopbar();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.nav.management) }));
    const names = screen
      .getAllByRole("navigation")
      .map((nav) => nav.getAttribute("aria-label")?.trim() ?? "");
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(2);
    expect(names).toContain(t.nav.management);
  });
});
