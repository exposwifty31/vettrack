/**
 * @vitest-environment happy-dom
 *
 * 7c RFID Readers console — a read-only view over the DERIVED reader registry
 * (rooms.gatewayCode + doorway heartbeat). Covers the management.webWrite gating
 * branch, that each derived reader renders with its room/status/last-seen, and that
 * a failed fetch keeps the chrome and degrades to the DataTable error affordance.
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
  api: { rfidReaders: { list: (...a: unknown[]) => listMock(...a) } },
}));

import RfidReadersConsolePage from "@/pages/console/RfidReadersConsolePage";

const READERS = [
  {
    gatewayCode: "GW-1",
    roomId: "room-1",
    roomName: "ICU",
    lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
    observedEquipmentCount: 3,
    status: "online",
  },
  {
    gatewayCode: "GW-2",
    roomId: null,
    roomName: null,
    lastSeenAt: null,
    observedEquipmentCount: 0,
    status: "no_signal",
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/rfid-readers" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <RfidReadersConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  listMock.mockReset();
});
afterEach(() => cleanup());

describe("RfidReadersConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders derived readers with room, status, and unassigned fallback", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue({ clinicId: "c1", readers: READERS, requestId: "r1" });
    renderPage();
    expect(await screen.findByText("GW-1")).toBeTruthy();
    expect(screen.getByText("ICU")).toBeTruthy();
    expect(screen.getByText(t.console.readerOnline)).toBeTruthy();
    // second reader: unassigned room + no-signal status
    expect(screen.getByText(t.console.readerUnassigned)).toBeTruthy();
    expect(screen.getByText(t.console.readerNoSignal)).toBeTruthy();
  });
});

describe("RfidReadersConsolePage — resilience", () => {
  it("keeps the chrome and degrades to the error affordance when the fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockRejectedValue(new Error("readers boom"));
    renderPage();
    expect(screen.getByText(t.console.rfidReaders.title)).toBeTruthy();
    expect((await screen.findAllByRole("button")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t.console.state.empty)).toBeNull();
  });
});
