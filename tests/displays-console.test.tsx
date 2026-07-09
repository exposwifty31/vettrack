/**
 * @vitest-environment happy-dom
 *
 * Phase 9 — Displays console. Covers the management.webWrite gating branch
 * (registry vs pending-server), that the device list renders name + last-seen +
 * status, the issue-pairing-code action surfacing the returned code, and the
 * manage drawer's two-step revoke calling the revoke endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
const listMock = vi.fn();
const renameMock = vi.fn();
const revokeMock = vi.fn();
const issueMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    display: {
      devices: {
        list: (...a: unknown[]) => listMock(...a),
        rename: (...a: unknown[]) => renameMock(...a),
        revoke: (...a: unknown[]) => revokeMock(...a),
      },
      pairIssue: (...a: unknown[]) => issueMock(...a),
    },
  },
}));

import DisplaysConsolePage from "@/pages/console/DisplaysConsolePage";
import type { DisplayDevice } from "@/types";

const DEVICES: DisplayDevice[] = [
  { id: "d1", name: "Ward TV", lastSeenAt: "2026-07-09T08:00:00.000Z", revokedAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-09T08:00:00.000Z" },
  { id: "d2", name: "Lobby", lastSeenAt: null, revokedAt: "2026-07-05T00:00:00.000Z", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-05T00:00:00.000Z" },
];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { hook } = memoryLocation({ path: "/admin/displays" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <DisplaysConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  listMock.mockReset();
  renameMock.mockReset();
  revokeMock.mockReset();
  issueMock.mockReset();
});
afterEach(() => cleanup());

describe("DisplaysConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
    // The issue-code affordance is a write, so it is hidden without webWrite.
    expect(screen.queryByRole("button", { name: t.console.displays.issueCode })).toBeNull();
  });

  it("renders the device registry (name + last seen + status) when granted", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(DEVICES);
    renderPage();
    expect(await screen.findByText("Ward TV")).toBeTruthy();
    expect(screen.getByText("Lobby")).toBeTruthy();
    // Active device shows Active; revoked device shows Revoked; never-seen → "Never".
    expect(screen.getByText(t.console.displays.statusActive)).toBeTruthy();
    expect(screen.getByText(t.console.displays.statusRevoked)).toBeTruthy();
    expect(screen.getByText(t.console.valNever)).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

describe("DisplaysConsolePage — issue pairing code", () => {
  it("issues a code and surfaces it in the dialog", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue([]);
    issueMock.mockResolvedValue({ code: "ABCD2345", expiresAt: "2026-07-09T09:00:00.000Z" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: t.console.displays.issueCode }));
    await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId("issued-pairing-code")).textContent).toBe("ABCD2345");
  });
});

describe("DisplaysConsolePage — manage drawer", () => {
  it("opens the drawer on row click and revokes on the two-step confirm", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(DEVICES);
    revokeMock.mockResolvedValue({ ok: true, id: "d1" });
    renderPage();

    fireEvent.click(await screen.findByText("Ward TV"));
    expect(await screen.findByText(t.console.displays.manageTitle)).toBeTruthy();

    // First click arms the confirm; revoke is not called yet.
    fireEvent.click(screen.getByRole("button", { name: t.console.displays.revoke }));
    expect(revokeMock).not.toHaveBeenCalled();

    // Second click (Confirm revoke) calls the endpoint with the device id.
    fireEvent.click(screen.getByRole("button", { name: t.console.displays.revokeConfirm }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith("d1"));
  });
});
