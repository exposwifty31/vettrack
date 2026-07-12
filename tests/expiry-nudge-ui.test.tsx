/**
 * @vitest-environment happy-dom
 *
 * T-30b — dismissible home-surface nudge UI (R-IN-F1 · small-03).
 * Nudges come from the already-merged GET /api/nudges feed (api.nudges.list —
 * see src/types/nudges.ts). Dismiss is a client-side localStorage id set —
 * it persists across a remount (simulating a reload) and never round-trips
 * to the server: nudges are compute-on-read, not stateful rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Nudge } from "@/types/nudges";

const listMock = vi.fn<(...args: unknown[]) => Promise<{ nudges: Nudge[] }>>();
vi.mock("@/lib/api", () => ({
  api: { nudges: { list: (...a: unknown[]) => listMock(...a) } },
}));

import { HomeNudges } from "@/features/today/surfaces/HomeNudges";

const EXPIRY_NUDGE: Nudge = {
  id: "expiry:eq-1",
  kind: "expiry",
  targetRole: "technician",
  entityId: "eq-1",
  createdAt: "2026-07-01T00:00:00.000Z",
};

function renderNudges() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeNudges />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("HomeNudges — renders the current user's feed", () => {
  it("renders a nudge from the feed", async () => {
    listMock.mockResolvedValue({ nudges: [EXPIRY_NUDGE] });
    renderNudges();
    await waitFor(() =>
      expect(screen.getByTestId(`home-nudge-${EXPIRY_NUDGE.id}`)).toBeTruthy(),
    );
  });

  it("renders nothing when the feed is empty", async () => {
    listMock.mockResolvedValue({ nudges: [] });
    renderNudges();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByTestId("home-nudges")).toBeNull();
  });
});

describe("HomeNudges — dismiss persists across a remount", () => {
  it("hides a dismissed nudge immediately and keeps it hidden after remount", async () => {
    listMock.mockResolvedValue({ nudges: [EXPIRY_NUDGE] });
    const { unmount } = renderNudges();

    await waitFor(() =>
      expect(screen.getByTestId(`home-nudge-${EXPIRY_NUDGE.id}`)).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`home-nudge-dismiss-${EXPIRY_NUDGE.id}`));
    expect(screen.queryByTestId(`home-nudge-${EXPIRY_NUDGE.id}`)).toBeNull();

    unmount();

    // Simulate a reload: fresh render, same localStorage, same feed from the server.
    renderNudges();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId(`home-nudge-${EXPIRY_NUDGE.id}`)).toBeNull();
  });
});
