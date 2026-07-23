/**
 * @vitest-environment happy-dom
 *
 * VetTrack 2.0, Task 1.1 §6 (deliverable F) — the ops-home autopilot queue
 * tile (mirrors `ExceptionsTile`'s tile-composition convention) and its
 * pure top-kind derivation helper (`topStagedKind`, extracted into
 * `ops-tile-helpers.tsx` per that file's existing pure-helper pattern —
 * `ALERT_ORDER`/`roomPct` — so it's unit-testable without mounting the
 * whole `useOpsHome` hook).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { topStagedKind } from "@/features/today/surfaces/ops/ops-tile-helpers";
import { AutopilotQueueTile } from "@/features/today/surfaces/ops/AutopilotQueueTile";
import type { ActionProposal } from "@/types/action-proposals";

function proposal(kind: ActionProposal["kind"], id: string): ActionProposal {
  return {
    id,
    clinicId: "clinic-A",
    kind,
    status: "staged",
    sourceSessionId: id,
    summary: "s",
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
  };
}

describe("topStagedKind", () => {
  it("returns null for an empty list", () => {
    expect(topStagedKind([])).toBeNull();
  });

  it("returns the most frequent kind", () => {
    const proposals = [
      proposal("restock_po_on_burn", "p1"),
      proposal("restock_po_on_burn", "p2"),
      proposal("crash_cart_drift", "p3"),
    ];
    expect(topStagedKind(proposals)).toBe("restock_po_on_burn");
  });

  it("breaks ties deterministically by the fixed kind order", () => {
    const proposals = [proposal("crash_cart_drift", "p1"), proposal("shift_handover_draft", "p2")];
    expect(topStagedKind(proposals)).toBe("shift_handover_draft");
  });
});

function renderTile(props: Parameters<typeof AutopilotQueueTile>[0]) {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <AutopilotQueueTile {...props} />
    </Router>,
  );
}

afterEach(() => cleanup());

describe("AutopilotQueueTile", () => {
  it("shows the empty copy when nothing is staged", () => {
    renderTile({ count: 0, topKind: null, isLoading: false });
    expect(screen.getByText(t.autopilotQueue.tile.empty)).toBeTruthy();
  });

  it("shows a count badge and the top-kind hint when proposals are staged", () => {
    renderTile({ count: 3, topKind: "restock_po_on_burn", isLoading: false });
    expect(screen.getByText("3")).toBeTruthy();
    expect(
      screen.getByText(t.autopilotQueue.tile.topKindHint(t.autopilotQueue.kinds.restockPoOnBurn.title)),
    ).toBeTruthy();
  });

  it("renders a skeleton while loading, not the empty copy", () => {
    renderTile({ count: 0, topKind: null, isLoading: true });
    expect(screen.queryByText(t.autopilotQueue.tile.empty)).toBeNull();
  });
});
