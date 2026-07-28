/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable B) — `ProposalCard` presentational
 * shell: kind title, summary, expandable cited-facts list, approve/edit/
 * reject action row, shadow-vs-enforce badge, `renderDraftContent` slot.
 * Server-confirmed updates: no optimistic status flip — success invalidates
 * the queue query; failure shows a loud toast and leaves the card as-is.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

const approveMock = vi.fn();
const editMock = vi.fn();
const rejectMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    actionProposals: {
      approve: (...args: unknown[]) => approveMock(...args),
      edit: (...args: unknown[]) => editMock(...args),
      reject: (...args: unknown[]) => rejectMock(...args),
    },
  },
}));
vi.mock("@/lib/ui-toast", () => ({
  toastSuccess: (...args: unknown[]) => toastSuccessMock(...args),
  toastError: (...args: unknown[]) => toastErrorMock(...args),
}));

import { ProposalCard } from "@/features/autopilot/ProposalCard";

function baseProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    clinicId: "clinic-A",
    kind: "restock_po_on_burn",
    status: "staged",
    sourceSessionId: "s1",
    summary: "3 items are at or below their reorder point",
    citedFacts: [
      { sourceId: "item-1", sourceTable: "vt_items", kind: "reorder_point_threshold", at: "2026-07-20T06:00:00.000Z" },
    ],
    draftContent: {
      supplierName: "Autopilot",
      scanDate: "2026-07-20",
      lines: [{ itemId: "item-1", quantitySuggested: 4 }],
      title: "Restock needed",
      suggestedQuantityLabel: "Suggested order quantity",
    },
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

function renderCard(proposal: ActionProposal) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <ProposalCard proposal={proposal} renderDraftContent={() => <div data-testid="slot-content" />} />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe("ProposalCard", () => {
  beforeEach(() => {
    approveMock.mockReset().mockResolvedValue({ proposal: baseProposal({ status: "approved" }) });
    editMock.mockReset().mockResolvedValue({ proposal: baseProposal({ status: "edited" }) });
    rejectMock.mockReset().mockResolvedValue({ proposal: baseProposal({ status: "rejected" }) });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => cleanup());

  it("renders the summary, the renderDraftContent slot, and the shadow badge", () => {
    renderCard(baseProposal());
    expect(screen.getByText("3 items are at or below their reorder point")).toBeTruthy();
    expect(screen.getByTestId("slot-content")).toBeTruthy();
    expect(screen.getByText(t.autopilotQueue.modeBadge.shadow)).toBeTruthy();
  });

  it("cited facts are collapsed by default and expand on toggle", () => {
    renderCard(baseProposal());
    expect(screen.queryByText("vt_items")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.citedFactsShow }));
    expect(screen.getByText("vt_items")).toBeTruthy();
    expect(screen.getByRole("button", { name: t.autopilotQueue.citedFactsHide })).toBeTruthy();
  });

  it("approve calls the API and invalidates the queue on success (server-confirmed, no optimism)", async () => {
    const { invalidateSpy } = renderCard(baseProposal());
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.approve }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalledWith(t.autopilotQueue.approveSuccess);
  });

  it("shows a loud toast and does not invalidate when approve fails", async () => {
    approveMock.mockRejectedValueOnce(new Error("network"));
    const { invalidateSpy } = renderCard(baseProposal());
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.approve }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(t.autopilotQueue.approveError));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("reject opens the reason dialog and submits with the API + toast + invalidate", async () => {
    const { invalidateSpy } = renderCard(baseProposal());
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.reject }));

    const textarea = await screen.findByLabelText(t.autopilotQueue.rejectReasonLabel);
    fireEvent.change(textarea, { target: { value: "Wrong candidate" } });
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.rejectSubmit }));

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith("p1", "Wrong candidate"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalledWith(t.autopilotQueue.rejectSuccess);
  });

  it("edit opens the structured restock dialog for restock_po_on_burn", async () => {
    renderCard(baseProposal());
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.edit }));
    expect(await screen.findByTestId("restock-edit-dialog")).toBeTruthy();
  });

  it("edit opens the generic edit-unavailable dialog for kinds without a structured editor", async () => {
    renderCard(
      baseProposal({
        kind: "crash_cart_drift",
        draftContent: {
          driftType: "stale_check",
          scanDate: "2026-07-20",
          hasNeverBeenChecked: true,
          lastCheckPerformedAt: null,
          hoursSinceLastCheck: null,
          thresholdHours: 24,
          title: "Crash cart needs attention",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: t.autopilotQueue.edit }));
    expect(await screen.findByTestId("edit-unavailable-dialog")).toBeTruthy();
  });
});
