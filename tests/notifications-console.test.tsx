/**
 * @vitest-environment happy-dom
 *
 * 7b Notifications console — read-only, clinic-scoped view over push + WhatsApp
 * deliveries. Covers the management.webWrite gating branch, that rows render with a
 * channel badge + the server-masked recipient (never a raw endpoint/phone), and that
 * a failed fetch keeps the chrome and degrades to the error affordance.
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
  api: { notifications: { list: (...a: unknown[]) => listMock(...a) } },
}));

import NotificationsConsolePage from "@/pages/console/NotificationsConsolePage";

const DELIVERIES = [
  { id: "p1", channel: "push", maskedTarget: "fcm.googleapis.com …3456", status: "active", createdAt: "2026-07-01T10:00:00.000Z" },
  { id: "w1", channel: "whatsapp", maskedTarget: "••••••4567", status: "sent", createdAt: "2026-07-01T09:00:00.000Z" },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/notifications" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <NotificationsConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  listMock.mockReset();
});
afterEach(() => cleanup());

describe("NotificationsConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders both channels with the masked recipient", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue({ clinicId: "c1", deliveries: DELIVERIES });
    renderPage();
    expect(await screen.findByText(t.console.channelPush)).toBeTruthy();
    expect(screen.getByText(t.console.channelWhatsapp)).toBeTruthy();
    // Masked targets render; nothing raw.
    expect(screen.getByText("fcm.googleapis.com …3456")).toBeTruthy();
    expect(screen.getByText("••••••4567")).toBeTruthy();
  });
});

describe("NotificationsConsolePage — resilience", () => {
  it("keeps the chrome and degrades to the error affordance when the fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockRejectedValue(new Error("notifications boom"));
    renderPage();
    expect(screen.getByText(t.console.notifications.title)).toBeTruthy();
    expect((await screen.findAllByRole("button")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t.console.state.empty)).toBeNull();
  });
});
