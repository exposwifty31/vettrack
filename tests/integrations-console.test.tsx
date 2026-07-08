/**
 * @vitest-environment happy-dom
 *
 * 7b Integrations console — binds to the adapter registry joined with clinic
 * configs. Covers the management.webWrite gating branch, that every registered
 * adapter is listed with configured/enabled status + its required-credential
 * NAMES (never secret values), and that a failed adapters fetch keeps the chrome
 * and degrades to the DataTable error affordance. Read-only slice — no mutation.
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
const adaptersMock = vi.fn();
const configsMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    integrations: {
      adapters: (...a: unknown[]) => adaptersMock(...a),
      listConfigs: (...a: unknown[]) => configsMock(...a),
    },
  },
}));

import IntegrationsConsolePage from "@/pages/console/IntegrationsConsolePage";

const ADAPTERS = [
  { id: "generic-pms", name: "Generic PMS", version: "1", capabilities: [], requiredCredentials: ["apiKey", "baseUrl"] },
  { id: "chameleon", name: "Chameleon", version: "1", capabilities: [], requiredCredentials: [] },
];
const CONFIGS = [{ adapterId: "generic-pms", enabled: true, updatedAt: "2026-01-01" }];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/integrations" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <IntegrationsConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  adaptersMock.mockReset();
  configsMock.mockReset();
});
afterEach(() => cleanup());

describe("IntegrationsConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(adaptersMock).not.toHaveBeenCalled();
  });

  it("lists the adapter registry joined with config status + credential names", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    adaptersMock.mockResolvedValue(ADAPTERS);
    configsMock.mockResolvedValue(CONFIGS);
    renderPage();
    expect(await screen.findByText("Generic PMS")).toBeTruthy();
    expect(screen.getByText("Chameleon")).toBeTruthy();
    // Required-credential NAMES (not secret values) for the configured adapter.
    expect(screen.getByText("apiKey, baseUrl")).toBeTruthy();
    // configured Yes (generic-pms) + No (chameleon) both present.
    expect(screen.getByText(t.console.valYes)).toBeTruthy();
    expect(screen.getByText(t.console.valNo)).toBeTruthy();
  });
});

describe("IntegrationsConsolePage — resilience", () => {
  it("keeps the page chrome and degrades to the error affordance when the adapters fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    adaptersMock.mockRejectedValue(new Error("adapters boom"));
    configsMock.mockResolvedValue([]);
    renderPage();
    expect(screen.getByText(t.console.integrations.title)).toBeTruthy();
    expect((await screen.findAllByRole("button")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t.console.state.empty)).toBeNull();
  });
});
