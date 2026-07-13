/**
 * @vitest-environment happy-dom
 *
 * T-40 (R-AD-01 / CLICK-PATH-009) — SupportSection's shared updateMut.onSuccess
 * unconditionally popped open the ticket detail editor and left detailStatus/
 * detailNote seeded from whatever the previous dialog session left behind.
 * An in-row quick-Resolve (which reuses the same mutation) must NOT pop the
 * editor when no dialog is open; and when a dialog IS already open, a
 * mutation success must re-seed detailStatus/detailNote from the server
 * response so a subsequent Save can't revert the change with stale state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { SupportTicket } from "@/types";

const listMock = vi.fn();
const updateMock = vi.fn();
const getConfigMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "admin-1" }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    support: {
      list: (...a: unknown[]) => listMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
    cursorBugFixer: {
      getConfig: (...a: unknown[]) => getConfigMock(...a),
    },
  },
}));

import { SupportSection } from "@/pages/admin/SupportSection";

const TICKET: SupportTicket = {
  id: "ticket-1",
  title: "Scanner won't pair",
  description: "Nothing happens on tap",
  severity: "low",
  status: "open",
  userId: "u1",
  userEmail: "user@example.com",
  pageUrl: null,
  deviceInfo: null,
  appVersion: null,
  adminNote: "original note",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SupportSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  updateMock.mockReset();
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue({
    enabled: false,
    apiKeyConfigured: false,
    repoUrlConfigured: false,
  });
});
afterEach(() => cleanup());

describe("SupportSection — quick-resolve doesn't pop a contradictory editor", () => {
  it("does not open the detail editor when quick-resolving a row with no dialog open", async () => {
    listMock.mockResolvedValue([TICKET]);
    updateMock.mockResolvedValue({ ...TICKET, status: "resolved" });
    renderSection();

    await screen.findByTestId(`ticket-row-${TICKET.id}`);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText(t.adminPage.ticketResolve));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    // No dialog was open before the quick-resolve — it must stay closed.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("btn-update-ticket")).toBeNull();
  });

  it("re-seeds detailStatus/detailNote from the mutation response when the dialog is already open", async () => {
    listMock.mockResolvedValue([TICKET]);
    renderSection();

    await screen.findByTestId(`ticket-row-${TICKET.id}`);
    fireEvent.click(screen.getByTestId(`ticket-row-${TICKET.id}`));

    // Dialog opened, seeded from the original ticket.
    await screen.findByTestId("btn-update-ticket");
    expect((screen.getByTestId("input-ticket-note") as HTMLTextAreaElement).value).toBe(
      "original note",
    );

    updateMock.mockResolvedValueOnce({
      ...TICKET,
      status: "resolved",
      adminNote: "note from server",
    });

    // Quick-resolve the same row while the dialog is open (shared mutation).
    fireEvent.click(screen.getByText(t.adminPage.ticketResolve));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));

    // The editor must re-seed from `updated`, not keep the stale local state.
    await waitFor(() =>
      expect((screen.getByTestId("input-ticket-note") as HTMLTextAreaElement).value).toBe(
        "note from server",
      ),
    );

    // A subsequent Save must submit the re-seeded status, proving detailStatus
    // was also re-seeded (not left at the stale "open" from initial openDetail).
    fireEvent.click(screen.getByTestId("btn-update-ticket"));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    expect(updateMock).toHaveBeenNthCalledWith(2, TICKET.id, {
      status: "resolved",
      adminNote: "note from server",
    });
  });
});
