import { t } from "@/lib/i18n";
import type { ActionProposalKind } from "@/types/action-proposals";

/** Shared kind → human title mapping, used by `ProposalCard`, `ProposalQueueList`, and `AutopilotQueueTile`. */
export function kindTitle(kind: ActionProposalKind): string {
  const kinds = t.autopilotQueue.kinds;
  switch (kind) {
    case "shift_handover_draft":
      return kinds.shiftHandoverDraft.title;
    case "coordinator_reassign_off_roster":
      return kinds.coordinatorReassignOffRoster.title;
    case "restock_po_on_burn":
      return kinds.restockPoOnBurn.title;
    case "crash_cart_drift":
      return kinds.crashCartDrift.title;
  }
}
