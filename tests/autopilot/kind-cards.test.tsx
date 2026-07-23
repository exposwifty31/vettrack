/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable C) — per-kind draft-content
 * renderers. Minimal, honest rendering of each kind's real `draftContent`
 * shape (per the composers in `server/lib/autopilot/*-composer.ts`) — no
 * import from `handover-artifact-panel.tsx` (confirmed, per the plan's §2
 * review note, to have no reusable sub-components).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { HandoverDraftCard } from "@/features/autopilot/cards/HandoverDraftCard";
import { CoordinatorReassignCard } from "@/features/autopilot/cards/CoordinatorReassignCard";
import { RestockPoCard } from "@/features/autopilot/cards/RestockPoCard";
import { CrashCartDriftCard } from "@/features/autopilot/cards/CrashCartDriftCard";
import type { ActionProposal } from "@/types/action-proposals";

afterEach(() => cleanup());

function baseProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    clinicId: "clinic-A",
    kind: "shift_handover_draft",
    status: "staged",
    sourceSessionId: "s1",
    summary: "summary",
    citedFacts: [],
    draftContent: {},
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

describe("HandoverDraftCard", () => {
  it("renders delta counts and open items", () => {
    const proposal = baseProposal({
      kind: "shift_handover_draft",
      draftContent: {
        shiftSessionId: "s1",
        windowStart: "2026-07-20T00:00:00.000Z",
        windowEnd: "2026-07-20T08:00:00.000Z",
        deltas: {
          custody: [{ sourceId: "a1", kind: "custody_return", targetId: "eq1", targetType: "equipment", at: "2026-07-20T01:00:00.000Z" }],
          taskState: [],
          alerts: [],
          dispenses: [],
        },
        openItems: [{ id: "eq2", kind: "task", summary: "task_started:eq2" }],
        title: "Shift handover ready for review",
      },
    });
    render(<HandoverDraftCard proposal={proposal} />);
    expect(screen.getByText(t.handoverPage.openItemsHeading)).toBeTruthy();
    expect(screen.getByText("task_started:eq2")).toBeTruthy();
  });

  it("shows the no-open-items copy when openItems is empty", () => {
    const proposal = baseProposal({
      draftContent: {
        shiftSessionId: "s1",
        windowStart: "2026-07-20T00:00:00.000Z",
        windowEnd: "2026-07-20T08:00:00.000Z",
        deltas: { custody: [], taskState: [], alerts: [], dispenses: [] },
        openItems: [],
        title: "x",
      },
    });
    render(<HandoverDraftCard proposal={proposal} />);
    expect(screen.getByText(t.handoverPage.openItemsNone)).toBeTruthy();
  });
});

describe("CoordinatorReassignCard", () => {
  it("renders the stale coordinator and a single auto-resolved candidate", () => {
    const proposal = baseProposal({
      kind: "coordinator_reassign_off_roster",
      draftContent: {
        shiftDate: "2026-07-20",
        staleCoordinatorUserId: "user-stale",
        escalationStage: 1,
        proposedReplacement: {
          status: "auto",
          coordinatorUserId: "user-2",
          candidates: [{ userId: "user-2", name: "Dana Cohen" }],
          suggestedFallbackUserId: null,
        },
        title: "Equipment Coordinator off roster",
        proposedCandidateLabel: "Suggested replacement",
      },
    });
    render(<CoordinatorReassignCard proposal={proposal} />);
    expect(screen.getByText(t.autopilotQueue.kinds.coordinatorReassignOffRoster.statusAuto)).toBeTruthy();
    expect(screen.getByText("Dana Cohen")).toBeTruthy();
  });

  it("renders the needs-confirmation state with multiple candidates", () => {
    const proposal = baseProposal({
      kind: "coordinator_reassign_off_roster",
      draftContent: {
        shiftDate: "2026-07-20",
        staleCoordinatorUserId: "user-stale",
        escalationStage: 0,
        proposedReplacement: {
          status: "needs_confirmation",
          coordinatorUserId: null,
          candidates: [
            { userId: "user-2", name: "Dana Cohen" },
            { userId: "user-3", name: "Yossi Levi" },
          ],
          suggestedFallbackUserId: "user-3",
        },
        title: "Equipment Coordinator off roster",
        proposedCandidateLabel: "Suggested replacement",
      },
    });
    render(<CoordinatorReassignCard proposal={proposal} />);
    expect(
      screen.getByText(t.autopilotQueue.kinds.coordinatorReassignOffRoster.statusNeedsConfirmation),
    ).toBeTruthy();
    expect(screen.getByText("Dana Cohen")).toBeTruthy();
    expect(screen.getByText("Yossi Levi")).toBeTruthy();
  });
});

describe("RestockPoCard", () => {
  it("renders supplier + line items with quantities", () => {
    const proposal = baseProposal({
      kind: "restock_po_on_burn",
      draftContent: {
        supplierName: "Autopilot",
        scanDate: "2026-07-20",
        lines: [
          { itemId: "item-1", quantitySuggested: 4 },
          { itemId: "item-2", quantitySuggested: 2 },
        ],
        title: "Restock needed",
        suggestedQuantityLabel: "Suggested order quantity",
      },
    });
    render(<RestockPoCard proposal={proposal} />);
    expect(screen.getByText("Autopilot")).toBeTruthy();
    expect(screen.getByText("item-1")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });
});

describe("CrashCartDriftCard", () => {
  it("renders failed items for the missing_items drift type", () => {
    const proposal = baseProposal({
      kind: "crash_cart_drift",
      draftContent: {
        driftType: "missing_items",
        scanDate: "2026-07-20",
        lastCheckId: "check-1",
        lastCheckPerformedAt: "2026-07-20T06:00:00.000Z",
        failedItems: [{ key: "epi", label: "Epinephrine", itemRowId: "row-1" }],
        title: "Crash cart needs attention",
      },
    });
    render(<CrashCartDriftCard proposal={proposal} />);
    expect(screen.getByText(t.autopilotQueue.kinds.crashCartDrift.failedItemsLabel)).toBeTruthy();
    expect(screen.getByText("Epinephrine")).toBeTruthy();
  });

  it("renders the stale-check state, including never-checked", () => {
    const proposal = baseProposal({
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
    });
    render(<CrashCartDriftCard proposal={proposal} />);
    expect(screen.getByText(t.autopilotQueue.kinds.crashCartDrift.neverCheckedLabel)).toBeTruthy();
  });
});
