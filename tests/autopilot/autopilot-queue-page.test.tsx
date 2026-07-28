/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable G) — the full approval-queue page.
 * Mobile-first: below the 1024px desktop breakpoint it renders the stacked
 * `ProposalQueueList`. Console variant (≥1024px): a two-column
 * master-detail layout per the `EquipmentMasterDetail` convention — a
 * compact selectable row list on the left, the selected proposal's full
 * `ProposalCard` on the right.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

const listMock = vi.fn();
let isDesktopMock = false;

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
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => isDesktopMock }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AutopilotQueuePage from "@/pages/autopilot-queue";

function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    clinicId: "clinic-A",
    kind: "restock_po_on_burn",
    status: "staged",
    sourceSessionId: "s1",
    summary: "Restock summary",
    citedFacts: [],
    draftContent: { supplierName: "Autopilot", scanDate: "2026-07-20", lines: [{ itemId: "item-1", quantitySuggested: 4 }], title: "x", suggestedQuantityLabel: "y" },
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <AutopilotQueuePage />
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

afterEach(() => cleanup());

describe("AutopilotQueuePage — mobile", () => {
  it("renders the stacked ProposalQueueList below the desktop breakpoint", async () => {
    isDesktopMock = false;
    listMock.mockResolvedValue({ proposals: [proposal()] });
    renderPage();
    expect(await screen.findByTestId("proposal-queue-list")).toBeTruthy();
  });
});

describe("AutopilotQueuePage — console (≥1024px)", () => {
  it("renders a master row list; selecting a row shows its expanded ProposalCard on the right", async () => {
    isDesktopMock = true;
    listMock.mockResolvedValue({
      proposals: [proposal({ id: "p1" }), proposal({ id: "p2", summary: "Second proposal" })],
    });
    renderPage();

    const row = await screen.findByTestId("proposal-row-p1");
    expect(screen.queryByTestId("proposal-card-p1")).toBeNull(); // nothing selected yet

    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("proposal-card-p1")).toBeTruthy());
  });
});
