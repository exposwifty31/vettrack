/**
 * @vitest-environment happy-dom
 *
 * R-M1.1e — RFID Readers console CRUD. The page is promoted from a read-only
 * derived-registry view into full management of the first-class `vt_rfid_readers`
 * entity: add / rename / deactivate a reader, provision (rotate) the per-clinic
 * HMAC ingest secret (revealed exactly once), toggle ingest, and surface each
 * reader's OWN-heartbeat health (offline badge). Every write is management-gated
 * (management.webWrite); a lead sees the honest pending-server state.
 *
 * Guardrails asserted at this layer: RFID is advisory-only, so nothing here writes
 * custody; the page reads the MANAGED entity (listManaged), never mutating equipment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const listManagedMock = vi.fn();
const createMock = vi.fn();
const renameMock = vi.fn();
const deactivateMock = vi.fn();
const provisionMock = vi.fn();
const setIngestMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    rfidReaders: {
      listManaged: (...a: unknown[]) => listManagedMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      rename: (...a: unknown[]) => renameMock(...a),
      deactivate: (...a: unknown[]) => deactivateMock(...a),
      provision: (...a: unknown[]) => provisionMock(...a),
      setIngest: (...a: unknown[]) => setIngestMock(...a),
    },
  },
}));

import RfidReadersConsolePage from "@/pages/console/RfidReadersConsolePage";
import type { ManagedRfidReaderRow } from "@/types";

const MANAGED: ManagedRfidReaderRow[] = [
  {
    id: "rd-1",
    clinicId: "c1",
    name: "ER Door",
    gatewayCode: "GW-1",
    roomId: "room-1",
    fromRoomId: null,
    toRoomId: null,
    gateType: null,
    physicalLocation: "North wing",
    status: "active",
    provisioningState: "legacy_unconfigured",
    lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
    lastReaderHeartbeatAt: new Date(Date.now() - 60_000).toISOString(),
    health: "online",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "rd-2",
    clinicId: "c1",
    name: "Ward Gate",
    gatewayCode: "GW-2",
    roomId: null,
    fromRoomId: null,
    toRoomId: null,
    gateType: null,
    physicalLocation: null,
    status: "active",
    provisioningState: "legacy_unconfigured",
    lastSeenAt: null,
    lastReaderHeartbeatAt: null,
    health: "offline",
    createdAt: null,
  },
];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
  listManagedMock.mockReset();
  createMock.mockReset();
  renameMock.mockReset();
  deactivateMock.mockReset();
  provisionMock.mockReset();
  setIngestMock.mockReset();
});
afterEach(() => cleanup());

describe("RfidReadersConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch or offer writes without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listManagedMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: t.console.rfidReaders.addReader })).toBeNull();
    expect(screen.queryByRole("button", { name: t.console.rfidReaders.provisionSecret })).toBeNull();
  });
});

describe("RfidReadersConsolePage — managed registry + health", () => {
  it("renders managed readers with the offline health badge and the write affordances", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockResolvedValue({ clinicId: "c1", readers: MANAGED, requestId: "r1" });
    renderPage();

    expect(await screen.findByText("ER Door")).toBeTruthy();
    expect(screen.getByText("GW-1")).toBeTruthy();
    expect(screen.getByText("Ward Gate")).toBeTruthy();
    // OWN-heartbeat health: rd-1 online, rd-2 offline (the offline badge must render).
    expect(screen.getByText(t.console.readerOnline)).toBeTruthy();
    expect(screen.getByText(t.console.readerOffline)).toBeTruthy();
    // Write affordances are present for a webWrite admin.
    expect(screen.getByRole("button", { name: t.console.rfidReaders.addReader })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.console.rfidReaders.provisionSecret })).toBeTruthy();
    expect(listManagedMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the chrome and degrades to the error affordance when the fetch fails", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockRejectedValue(new Error("readers boom"));
    renderPage();
    expect(screen.getByText(t.console.rfidReaders.title)).toBeTruthy();
    expect((await screen.findAllByRole("button")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t.console.state.empty)).toBeNull();
  });
});

describe("RfidReadersConsolePage — create", () => {
  it("creates a reader from the add drawer with name + gateway", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockResolvedValue({ clinicId: "c1", readers: MANAGED, requestId: "r1" });
    createMock.mockResolvedValue({ clinicId: "c1", reader: MANAGED[0], requestId: "r2" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: t.console.rfidReaders.addReader }));
    expect(await screen.findByText(t.console.rfidReaders.createTitle)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(t.console.rfidReaders.nameLabel), {
      target: { value: "Pharmacy Door" },
    });
    fireEvent.change(screen.getByLabelText(t.console.rfidReaders.gatewayLabel), {
      target: { value: "GW-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.console.rfidReaders.create }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Pharmacy Door", gatewayCode: "GW-9" }),
      ),
    );
  });
});

describe("RfidReadersConsolePage — manage (rename + deactivate)", () => {
  it("opens the manage drawer on row click and deactivates on the two-step confirm", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockResolvedValue({ clinicId: "c1", readers: MANAGED, requestId: "r1" });
    deactivateMock.mockResolvedValue({ clinicId: "c1", reader: { ...MANAGED[1], status: "inactive" }, requestId: "r3" });
    renderPage();

    fireEvent.click(await screen.findByText("Ward Gate"));
    expect(await screen.findByText(t.console.rfidReaders.manageTitle)).toBeTruthy();

    // First click arms the confirm; deactivate is not called yet.
    fireEvent.click(screen.getByRole("button", { name: t.console.rfidReaders.deactivate }));
    expect(deactivateMock).not.toHaveBeenCalled();

    // Second click (confirm) calls the clinic-scoped endpoint with the reader id.
    fireEvent.click(screen.getByRole("button", { name: t.console.rfidReaders.deactivateConfirm }));
    await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith("rd-2"));
  });

  it("renames a reader from the manage drawer", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockResolvedValue({ clinicId: "c1", readers: MANAGED, requestId: "r1" });
    renameMock.mockResolvedValue({ clinicId: "c1", reader: { ...MANAGED[0], name: "ER Main" }, requestId: "r4" });
    renderPage();

    fireEvent.click(await screen.findByText("ER Door"));
    const nameInput = (await screen.findByLabelText(t.console.rfidReaders.nameLabel)) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "ER Main" } });
    fireEvent.click(screen.getByRole("button", { name: t.console.rfidReaders.save }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledWith("rd-1", "ER Main"));
  });
});

describe("RfidReadersConsolePage — provision secret + ingest toggle", () => {
  it("provisions (rotates) the secret and reveals it exactly once", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockResolvedValue({ clinicId: "c1", readers: MANAGED, requestId: "r1" });
    provisionMock.mockResolvedValue({
      clinicId: "c1",
      rotation: {
        rotationId: "rot-1",
        status: "completed",
        secret: "s3cr3t-abcdef0123456789",
        secretDelivered: true,
        graceExpiresAt: "2026-07-18T00:00:00.000Z",
        rollbackAvailable: false,
        snapshotReaderIds: [],
      },
      requestId: "r5",
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: t.console.rfidReaders.provisionSecret }));
    await waitFor(() => expect(provisionMock).toHaveBeenCalledTimes(1));
    // The plaintext secret is surfaced once in the reveal dialog.
    const reveal = await screen.findByTestId("provisioned-secret");
    expect(reveal.textContent).toBe("s3cr3t-abcdef0123456789");
    // ...and NOWHERE else — the one-time disclosure guarantee means the plaintext
    // must appear exactly once across the whole rendered page.
    expect(screen.getAllByText("s3cr3t-abcdef0123456789")).toHaveLength(1);
  });

  it("toggles ingest on and off through the provisioning endpoint", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listManagedMock.mockResolvedValue({ clinicId: "c1", readers: MANAGED, requestId: "r1" });
    setIngestMock.mockResolvedValue({ clinicId: "c1", enabled: true, requestId: "r6" });
    renderPage();

    await screen.findByText("ER Door");
    fireEvent.click(screen.getByRole("button", { name: t.console.rfidReaders.ingestEnable }));
    await waitFor(() => expect(setIngestMock).toHaveBeenCalledWith(true));

    setIngestMock.mockResolvedValue({ clinicId: "c1", enabled: false, requestId: "r7" });
    fireEvent.click(screen.getByRole("button", { name: t.console.rfidReaders.ingestDisable }));
    await waitFor(() => expect(setIngestMock).toHaveBeenCalledWith(false));
  });
});

describe("RfidReadersConsolePage — advisory-only guardrail", () => {
  it("only calls the rfidReaders API — never a custody/equipment mutation (RFID is advisory-only)", async () => {
    const source = await import("fs").then((fs) =>
      fs.readFileSync("src/pages/console/RfidReadersConsolePage.tsx", "utf8"),
    );
    // Every `api.<domain>` reference in this console must be `api.rfidReaders.*`.
    const apiCalls = source.match(/api\.[A-Za-z]+/g) ?? [];
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) {
      expect(call).toBe("api.rfidReaders");
    }
  });
});
