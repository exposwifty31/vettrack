import type { ReactNode } from "react";
import { HandoverDraftCard } from "./cards/HandoverDraftCard";
import { CoordinatorReassignCard } from "./cards/CoordinatorReassignCard";
import { RestockPoCard } from "./cards/RestockPoCard";
import { CrashCartDriftCard } from "./cards/CrashCartDriftCard";
import type { ActionProposal } from "@/types/action-proposals";

/**
 * VetTrack 2.0, Task 1.1 §6 — the single per-kind draft-content dispatcher,
 * shared by `ProposalQueueList` (mobile-first stacked cards) and the
 * console master-detail page's expanded-detail pane, so both surfaces
 * render the SAME kind-specific renderer rather than duplicating the switch.
 */
export function renderDraftContentForKind(proposal: ActionProposal): ReactNode {
  switch (proposal.kind) {
    case "shift_handover_draft":
      return <HandoverDraftCard proposal={proposal} />;
    case "coordinator_reassign_off_roster":
      return <CoordinatorReassignCard proposal={proposal} />;
    case "restock_po_on_burn":
      return <RestockPoCard proposal={proposal} />;
    case "crash_cart_drift":
      return <CrashCartDriftCard proposal={proposal} />;
  }
}
