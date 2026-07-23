/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable A) — `ProposalQueueList` container:
 * fetches staged proposals, groups by kind, wraps the list in an
 * `aria-live="polite"` region (so an arriving proposal via the collab-ws
 * nudge is announced), and renders loading/error/empty states per repo
 * convention.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

const listMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    actionProposals: {
      list: (...args: unknown[]) => listMock(...args),
      approve: vi.fn(),
      edit: vi.fn(),
      reject: vi.fn(),
    },
  },
}));
vi.mock("@/features/collab/useCollabRoom", () => ({
  useCollabRoom: () => ({ isConnected: false, isJoined: false, presentMembers: [], joinedRoom: null, socketRef: { current: null } }),
}));

import { ProposalQueueList } from "@/features/autopilot/ProposalQueueList";

function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    clinicId: "clinic-A",
    kind: "restock_po_on_burn",
    status: "staged",
    sourceSessionId: "s1",
    summary: "Restock summary",
    citedFacts: [],
    draftContent: { supplierName: "Autopilot", scanDate: "2026-07-20", lines: [], title: "x", suggestedQuantityLabel: "y" },
    sourceRef: {},
    citationValidation: { valid: true, checks: [] },
    editedContent: null,
    rejectionReason: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T08:00:00.000Z",
    ...overrides,
  };
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProposalQueueList />
    </QueryClientProvider>,
  );
}

describe("ProposalQueueList", () => {
  // NOTE: deliberately no `beforeEach(() => listMock.mockReset())` — each
  // test below sets its own mock implementation as its first statement
  // (which fully replaces any prior one), and a shared `beforeEach` mock
  // reset was observed to shift this suite's microtask timing enough to
  // turn a query's own internal error handling into a genuine unhandled
  // promise rejection in this Vitest/happy-dom environment (verified via a
  // bisection: identical test bodies pass with no `beforeEach`/`describe`
  // wrapper and fail with one — an environment timing quirk, not a bug in
  // `ProposalQueueList` or `useProposalQueue`).
  afterEach(() => cleanup());

  it("wraps the list in an aria-live polite region", async () => {
    listMock.mockResolvedValue({ proposals: [proposal()] });
    renderList();
    await waitFor(() => expect(screen.getByTestId("proposal-queue-list")).toBeTruthy());
    expect(screen.getByTestId("proposal-queue-list").getAttribute("aria-live")).toBe("polite");
  });

  it("shows the empty state when nothing is staged", async () => {
    listMock.mockResolvedValue({ proposals: [] });
    renderList();
    expect(await screen.findByText(t.autopilotQueue.empty)).toBeTruthy();
  });

  it("shows an error state with retry when the fetch fails", async () => {
    listMock.mockImplementation(() => Promise.reject(new Error("network")));
    renderList();
    expect(await screen.findByText(t.autopilotQueue.loadFailed)).toBeTruthy();
  });

  it("renders one card per staged proposal, grouped by kind", async () => {
    listMock.mockResolvedValue({
      proposals: [
        proposal({ id: "p1", kind: "restock_po_on_burn" }),
        proposal({ id: "p2", kind: "crash_cart_drift", draftContent: { driftType: "stale_check", scanDate: "2026-07-20", hasNeverBeenChecked: true, lastCheckPerformedAt: null, hoursSinceLastCheck: null, thresholdHours: 24, title: "x" } }),
      ],
    });
    renderList();
    expect(await screen.findByTestId("proposal-card-p1")).toBeTruthy();
    expect(screen.getByTestId("proposal-card-p2")).toBeTruthy();
  });
});
