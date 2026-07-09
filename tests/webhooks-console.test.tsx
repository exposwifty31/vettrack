/**
 * @vitest-environment happy-dom
 *
 * 7b Webhooks console — read-only view over the clinic's inbound PMS webhook event
 * log. Covers the management.webWrite gating branch, that events render with adapter/
 * status/signature-validity, and that a failed fetch keeps the chrome and degrades to
 * the DataTable error affordance. The event payload is redacted server-side (never in
 * the WebhookEventRow type), so there is nothing sensitive for the page to render.
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
const listMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { webhooks: { list: (...a: unknown[]) => listMock(...a) } },
}));

import WebhooksConsolePage from "@/pages/console/WebhooksConsolePage";

const EVENTS = [
  { id: "e1", adapterId: "generic-pms", status: "processed", signatureValid: true, createdAt: "2026-07-01T10:00:00.000Z", processedAt: "2026-07-01T10:00:05.000Z" },
  { id: "e2", adapterId: "chameleon", status: "rejected_signature", signatureValid: false, createdAt: "2026-07-01T09:00:00.000Z", processedAt: null },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/webhooks" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <WebhooksConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  listMock.mockReset();
});
afterEach(() => cleanup());

describe("WebhooksConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists inbound events with adapter, status, and signature validity", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue({ clinicId: "c1", events: EVENTS });
    renderPage();
    expect(await screen.findByText("generic-pms")).toBeTruthy();
    expect(screen.getByText("chameleon")).toBeTruthy();
    expect(screen.getByText(t.console.sigValid)).toBeTruthy();
    expect(screen.getByText(t.console.sigInvalid)).toBeTruthy();
  });
});

describe("WebhooksConsolePage — resilience", () => {
  it("keeps the chrome and degrades to the error affordance when the fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockRejectedValue(new Error("webhooks boom"));
    renderPage();
    expect(screen.getByText(t.console.webhooks.title)).toBeTruthy();
    expect((await screen.findAllByRole("button")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t.console.state.empty)).toBeNull();
  });
});
