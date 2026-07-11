/**
 * @vitest-environment happy-dom
 *
 * Phase 9 — Displays console. Covers the management.webWrite gating branch
 * (registry vs pending-server), that the device list renders name + last-seen +
 * status, the issue-pairing-code action surfacing the returned code, the manage
 * drawer's two-step revoke calling the revoke endpoint, and (Phase 10 / T21) a
 * live device's last-seen renders a real time (not "Never"), a two-step delete
 * for dead (revoked) rows, and revoke/cancel resolving to distinct copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { loadLocaleFile } from "../scripts/i18n/check-parity";

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
const deleteMock = vi.fn();
const issueMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    display: {
      devices: {
        list: (...a: unknown[]) => listMock(...a),
        rename: (...a: unknown[]) => renameMock(...a),
        revoke: (...a: unknown[]) => revokeMock(...a),
        delete: (...a: unknown[]) => deleteMock(...a),
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
  deleteMock.mockReset();
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

describe("DisplaysConsolePage — live last-seen (T21 item 1)", () => {
  it("renders a real timestamp (not the 'Never' label) for a device with a recent lastSeenAt", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(DEVICES);
    renderPage();

    const nameCell = await screen.findByText("Ward TV");
    const row = nameCell.closest("tr");
    expect(row).toBeTruthy();
    // The live device's row must NOT show "Never" — its lastSeenAt is set.
    expect(within(row as HTMLElement).queryByText(t.console.valNever)).toBeNull();
    // It must render the actual heartbeat-sourced timestamp instead.
    const expected = new Date(DEVICES[0]!.lastSeenAt as string).toLocaleString();
    expect(within(row as HTMLElement).getByText(expected)).toBeTruthy();

    // Only the never-seen (revoked, lastSeenAt: null) row shows "Never".
    expect(screen.getAllByText(t.console.valNever)).toHaveLength(1);
  });

  it("polls the registry on an interval so a heartbeat bump surfaces without a manual reload (no new realtime channel — admin-console poll only)", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(DEVICES);
    renderPage();
    await screen.findByText("Ward TV");
    // This is the existing F7/F8 fix (refetchInterval / refetchOnWindowFocus on
    // the devices query) — assert it stays wired rather than re-adding polling.
    const source = await import("fs").then((fs) =>
      fs.readFileSync("src/pages/console/DisplaysConsolePage.tsx", "utf8"),
    );
    expect(source).toMatch(/refetchInterval:\s*DEVICES_REFETCH_MS/);
    expect(source).toMatch(/refetchOnWindowFocus:\s*true/);
  });
});

describe("DisplaysConsolePage — delete dead rows (T21 item 3)", () => {
  it("offers delete only for a revoked device, not an active one", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(DEVICES);
    renderPage();

    // Active device (Ward TV) — no delete affordance.
    fireEvent.click(await screen.findByText("Ward TV"));
    expect(await screen.findByText(t.console.displays.manageTitle)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.console.displays.delete })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.common.cancel }));

    // Revoked device (Lobby) — delete affordance is present.
    fireEvent.click(await screen.findByText("Lobby"));
    expect(await screen.findByRole("button", { name: t.console.displays.delete })).toBeTruthy();
  });

  it("removes a dead row on the two-step confirm and calls the clinic-scoped delete endpoint", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValueOnce(DEVICES).mockResolvedValueOnce([DEVICES[0]!]);
    deleteMock.mockResolvedValue({ ok: true, id: "d2" });
    renderPage();

    fireEvent.click(await screen.findByText("Lobby"));
    expect(await screen.findByText(t.console.displays.manageTitle)).toBeTruthy();

    // First click arms the confirm; delete is not called yet.
    fireEvent.click(screen.getByRole("button", { name: t.console.displays.delete }));
    expect(deleteMock).not.toHaveBeenCalled();

    // Second click (confirm) calls the endpoint with the device id.
    fireEvent.click(screen.getByRole("button", { name: t.console.displays.deleteConfirm }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("d2"));

    // The drawer closes and the registry refetches — the dead row is gone.
    await waitFor(() => expect(screen.queryByText(t.console.displays.manageTitle)).toBeNull());
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Lobby")).toBeNull());
    expect(screen.getByText("Ward TV")).toBeTruthy();
  });
});

describe("DisplaysConsolePage — revoke vs cancel labels (T21 item 4)", () => {
  it("resolve to distinct t.* keys and distinct, non-confusable copy in both locales", () => {
    // Distinct keys (structural — a shared key would make this trivially equal).
    expect(t.console.displays.revoke).not.toBe(t.common.cancel);

    const en = loadLocaleFile("en") as {
      console: { displays: { revoke: string } };
      common: { cancel: string };
    };
    const he = loadLocaleFile("he") as {
      console: { displays: { revoke: string } };
      common: { cancel: string };
    };

    for (const dict of [en, he]) {
      const revoke = dict.console.displays.revoke;
      const cancel = dict.common.cancel;
      expect(revoke).not.toBe(cancel);
      // Neither label may be a prefix of the other — that's the exact
      // confusability the audit flagged ("ביטול מכשיר" vs "ביטול").
      expect(revoke.startsWith(cancel)).toBe(false);
      expect(cancel.startsWith(revoke)).toBe(false);
    }
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
