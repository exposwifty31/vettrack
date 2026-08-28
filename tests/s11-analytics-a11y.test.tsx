/**
 * @vitest-environment happy-dom
 *
 * S11.4 — analytics.tsx: an EmptyState under a CardTitle (<h3>) rendered its
 * default <h2>, walking the heading outline backwards; and the two Recharts
 * SVGs had an empty <title>/<desc>. Assertions read the LIVE DOM.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { cloneElement } from "react";
import { t } from "@/lib/i18n";

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

afterEach(() => cleanup());

import AnalyticsPage from "@/pages/analytics";
import { api } from "@/lib/api";

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

describe("S11.4 failure path — a rejected summary renders the scoped error, not a blank page", () => {
  it("shows the load-failed error card when the summary query rejects", async () => {
    vi.mocked(api.analytics.summary).mockRejectedValueOnce(new Error("summary down"));
    renderAnalytics();
    expect(await screen.findByText(t.analyticsPage.loadFailed)).toBeTruthy();
  });
});

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
