/**
 * @vitest-environment happy-dom
 *
 * 7a Ops Health console — observe-only. Covers the management.webWrite gating
 * branch (health summary + DLQ vs pending-server), that the outbox-health summary
 * cards render their values, and that a failed DLQ fetch keeps the page chrome +
 * degrades to the DataTable error affordance (retry:false path). No mutation path
 * exists (controls are intentionally unwired per the frozen-surface doctrine).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const healthMock = vi.fn();
const dlqMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    adminOutboxHealth: { get: (...a: unknown[]) => healthMock(...a) },
    adminOutboxDlq: { list: (...a: unknown[]) => dlqMock(...a) },
  },
}));

import OpsHealthConsolePage from "@/pages/console/OpsHealthConsolePage";

const HEALTH = {
  clinicId: "c1", publish_lag_ms: 120, outbox_size: 3, events_per_sec: 1,
  duplicate_drops_count: 0, gap_resync_count: 0, failed_publish_attempts: 0,
  dead_letter_count: 2, dlq_permanent_count: 1, dlq_transient_count: 0,
  dlq_unclassified_count: 0, next_retry_wave_in_ms: null, max_retry_horizon_ms: null, requestId: "r1",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/ops/health" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <OpsHealthConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  healthMock.mockReset();
  dlqMock.mockReset();
});
afterEach(() => cleanup());

describe("OpsHealthConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(healthMock).not.toHaveBeenCalled();
    expect(dlqMock).not.toHaveBeenCalled();
  });

  it("renders the outbox-health summary cards + DLQ table when granted", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    healthMock.mockResolvedValue(HEALTH);
    dlqMock.mockResolvedValue({ items: [] });
    renderPage();
    // The label renders immediately; wait for the resolved value (card exits its loading skeleton).
    expect(await screen.findByText("3")).toBeTruthy(); // outbox_size
    expect(screen.getByText(t.console.opsHealth.outboxSize)).toBeTruthy(); // label
    expect(screen.getByText("2")).toBeTruthy(); // dead_letter_count
    expect(screen.getByText("1")).toBeTruthy(); // dlq_permanent_count
    expect(healthMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpsHealthConsolePage — resilience", () => {
  it("keeps the page chrome and shows the DLQ error affordance when the DLQ fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    healthMock.mockResolvedValue(HEALTH);
    dlqMock.mockRejectedValue(new Error("dlq boom"));
    renderPage();
    expect(screen.getByText(t.console.opsHealth.title)).toBeTruthy();
    // Health summary still renders; the DLQ table degrades to ErrorCard (retry button).
    expect((await screen.findAllByRole("button")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t.console.state.empty)).toBeNull();
  });
});
