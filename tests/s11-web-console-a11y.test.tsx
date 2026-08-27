/**
 * @vitest-environment happy-dom
 *
 * S11 — web console accessibility locks.
 *
 * Every assertion here reads the LIVE DOM (or the live function result), never
 * the source diff: the plan's proof gate for this slice is explicitly
 * "role / aria-pressed / heading level read back from the live DOM".
 *
 * Covered:
 *   1. admin.tsx      — hand-rolled tab strip had no tab semantics at all
 *                       (6 plain <button>s, no tablist/tab/tabpanel, no
 *                       aria-selected, no arrow-key navigation).
 *   2. equipment-list  — the status + recovery filter chips are toggles that
 *                       announced no pressed state.
 *   3. WebOnlyGuard    — the guard overlay sat below the shift-chat FAB (z-60)
 *                       and panel (z-65), so chat floated over a screen that
 *                       exists to say "this surface is unavailable here".
 *   4. analytics.tsx   — an EmptyState under a CardTitle (<h3>) rendered its
 *                       default <h2>, walking the heading outline backwards;
 *                       and the two Recharts SVGs had an empty <title>/<desc>.
 *   5-7. Topbar menus  — aria-haspopup="true" maps to "menu", but neither
 *                       popup is a menu (they are links / toggles). The honest
 *                       pattern is a disclosure: aria-expanded + aria-controls.
 *   8. formatDateByLocale — bare toLocaleDateString gives an ambiguous
 *                       all-numeric date ("8/26/2026" vs "26.8.2026").
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { readFileSync } from "fs";
import { resolve } from "path";
import { cloneElement } from "react";
import { t } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// 1. admin.tsx — tab strip semantics
// ---------------------------------------------------------------------------

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
    const selectedTab = screen
      .getAllByRole("tab")
      .find((el) => el.getAttribute("aria-selected") === "true")!;
    expect(panel.getAttribute("aria-labelledby")).toBe(selectedTab.id);
    expect(selectedTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.querySelector('[data-testid="section-folders"]')).toBeTruthy();
  });

  it("uses a roving tabindex so the strip is ONE tab stop, not six", () => {
    renderAdmin();
    // The tablist itself is the tab stop; focus is then delegated to the
    // active tab. Six sequentially-tabbable buttons is what this replaces.
    expect(screen.getByRole("tablist").getAttribute("tabindex")).toBe("0");
    for (const tab of screen.getAllByRole("tab")) {
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

// ---------------------------------------------------------------------------
// 2. equipment-list.tsx — filter chips are toggles; say so
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 3. WebOnlyGuard — the guard must out-stack the shift-chat launcher
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => false }));
vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  isCapacitorIOS: () => false,
  isCapacitorAndroid: () => false,
}));

import { WebOnlyGuard } from "@/app/platform/guards/WebOnlyGuard";

/** Highest `z-[n]` literal in a source file, or null when it has none. */
function maxArbitraryZ(relPath: string): number | null {
  const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const found = [...src.matchAll(/z-\[(\d+)\]/g)].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : null;
}

describe("S11.3 — the web-only guard stacks above the shift-chat launcher", () => {
  it("renders the guard screen above both the chat FAB and the chat panel", () => {
    render(
      <Router hook={memoryLocation({ path: "/analytics" }).hook}>
        <WebOnlyGuard>
          <div data-testid="gated-child" />
        </WebOnlyGuard>
      </Router>,
    );

    const guard = screen.getByTestId("web-only-guard-screen");
    expect(screen.queryByTestId("gated-child")).toBeNull();

    const zClass = Array.from(guard.classList).find((c) => /^z-/.test(c));
    expect(zClass).toBeTruthy();
    const guardZ = Number(/^z-\[?(\d+)\]?$/.exec(zClass!)?.[1]);
    expect(Number.isFinite(guardZ)).toBe(true);

    const fabZ = maxArbitraryZ("src/features/shift-chat/components/ShiftChatFab.tsx");
    const panelZ = maxArbitraryZ("src/features/shift-chat/components/ShiftChatPanel.tsx");
    expect(fabZ).not.toBeNull();
    expect(panelZ).not.toBeNull();
    expect(guardZ).toBeGreaterThan(fabZ!);
    expect(guardZ).toBeGreaterThan(panelZ!);
  });
});

// ---------------------------------------------------------------------------
// 4. analytics.tsx — heading outline + named charts
// ---------------------------------------------------------------------------

// happy-dom reports a 0x0 container, so the real ResponsiveContainer renders
// nothing. Substitute ONLY the sizing wrapper — the chart itself, and therefore
// the <title>/<desc> under test, is the genuine recharts render.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 400, height: 200 }),
  };
});

import AnalyticsPage from "@/pages/analytics";

function renderAnalytics() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <Router hook={memoryLocation({ path: "/analytics" }).hook}>
          <AnalyticsPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("S11.4a — analytics empty state does not walk the heading outline backwards", () => {
  it("renders the top-problem empty state as an h3 under its h3 CardTitle", async () => {
    renderAnalytics();
    const heading = await screen.findByText(t.analyticsPage.noIssuesReported);
    // CardTitle renders an <h3>; an unqualified EmptyState defaults to <h2>.
    expect(heading.tagName).toBe("H3");
  });

  it("never places the empty-state heading ABOVE the card heading it sits under", async () => {
    const { container } = renderAnalytics();
    await screen.findByText(t.analyticsPage.noIssuesReported);

    const level = (el: Element) => Number(el.tagName.slice(1));
    const headings = Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const cardTitle = headings.find(
      (el) => el.textContent === t.analyticsPage.topProblemEquipment,
    );
    const emptyHeading = headings.find(
      (el) => el.textContent === t.analyticsPage.noIssuesReported,
    );
    expect(cardTitle).toBeTruthy();
    expect(emptyHeading).toBeTruthy();
    // Scoped deliberately: this locks the backwards walk the slice fixes, not
    // the separate (pre-existing, card.tsx-wide) h1→h3 gap above it.
    expect(level(emptyHeading!)).toBeGreaterThanOrEqual(level(cardTitle!));
  });
});

describe("S11.4b — the analytics charts carry a name and a description", () => {
  it("gives both chart SVGs a non-empty <title> and <desc>", async () => {
    const { container } = renderAnalytics();
    await screen.findByText(t.analyticsPage.noIssuesReported);

    const svgs = Array.from(container.querySelectorAll(".recharts-wrapper > svg.recharts-surface"));
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg.querySelector("title")?.textContent?.trim()).toBeTruthy();
      expect(svg.querySelector("desc")?.textContent?.trim()).toBeTruthy();
    }
  });

  it("names each chart with its own visible heading and describes what it plots", async () => {
    const { container } = renderAnalytics();
    await screen.findByText(t.analyticsPage.noIssuesReported);

    const titles = Array.from(container.querySelectorAll(".recharts-wrapper > svg.recharts-surface > title")).map(
      (el) => el.textContent,
    );
    const descs = Array.from(container.querySelectorAll(".recharts-wrapper > svg.recharts-surface > desc")).map(
      (el) => el.textContent,
    );
    expect(titles).toContain(t.analyticsPage.statusDistribution);
    expect(titles).toContain(t.analyticsPage.scanActivity14Days);
    expect(descs).toContain(t.analyticsPage.statusDistributionChartDesc);
    expect(descs).toContain(t.analyticsPage.scanActivityChartDesc);
  });
});

// ---------------------------------------------------------------------------
// 5. TopbarManagementMenu — disclosure, not a fake menu
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 6. TopbarSettingsMenu — same lie, different panel
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: { locale: "he", density: "comfortable" },
    update: vi.fn(),
  }),
  useIsDarkActive: () => false,
}));

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

// ---------------------------------------------------------------------------
// 7. Topbar — two navigation landmarks need two distinct names
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 8. formatDateByLocale — an all-numeric date is ambiguous in every locale
// ---------------------------------------------------------------------------

import { formatDateByLocale, getCurrentLocale } from "@/lib/i18n";

// Noon UTC — same calendar day in any reasonable local timezone.
const SAMPLE_ISO = "2026-08-26T12:00:00.000Z";

describe("S11.8 — the default date format names its month", () => {
  it("no longer renders the bare numeric form that 26/08 vs 08/26 makes ambiguous", () => {
    const localeTag = getCurrentLocale() === "he" ? "he-IL" : "en-US";
    const bareNumeric = new Date(SAMPLE_ISO).toLocaleDateString(localeTag);

    const rendered = formatDateByLocale(SAMPLE_ISO);
    expect(rendered).not.toBe(bareNumeric);
    // A named month means at least one non-digit, non-separator character.
    expect(/[^\d\s./\-–,]/u.test(rendered)).toBe(true);
    expect(rendered).toBe(
      new Date(SAMPLE_ISO).toLocaleDateString(localeTag, { dateStyle: "medium" }),
    );
  });

  it("still lets an explicit options object win", () => {
    expect(formatDateByLocale(SAMPLE_ISO, { year: "numeric" })).toBe("2026");
  });
});

// ---------------------------------------------------------------------------
// 9. locales — Hebrew word order in the admin pending-users heading
// ---------------------------------------------------------------------------

describe("S11.9 — the pending-users heading reads as Hebrew, not as English word order", () => {
  const he = JSON.parse(readFileSync(resolve(process.cwd(), "locales/he.json"), "utf8"));
  const en = JSON.parse(readFileSync(resolve(process.cwd(), "locales/en.json"), "utf8"));
  const NOUN = "משתמשים";
  const MODIFIER = "ממתינים";

  it("puts the noun before its modifier", () => {
    const title: string = he.adminPage.pendingUsersTitle;
    expect(title).toContain(NOUN);
    expect(title).toContain(MODIFIER);
    expect(title.indexOf(NOUN)).toBeLessThan(title.indexOf(MODIFIER));
  });

  it("matches the order its own sibling copy already uses", () => {
    // `pendingEmpty` ("אין משתמשים ממתינים") was always correct — it is the
    // in-file proof that the heading's order was the typo, not a house style.
    const empty: string = he.adminPage.pendingEmpty;
    expect(empty.indexOf(NOUN)).toBeLessThan(empty.indexOf(MODIFIER));
  });

  it("leaves the English side alone", () => {
    expect(en.adminPage.pendingUsersTitle).toBe("Pending users");
  });
});
