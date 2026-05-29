import type { EvidenceEquipmentRow, SupersessionEvent } from "./graph.types.js";

const SUPERSEDING_TYPES = new Set<SupersessionEvent["type"]>([
  "return",
  "transfer",
  "custody_docked",
  "custody_returned",
  "custody_untracked",
  "re_checkout",
]);

/** True when a superseding event occurred after the checkout anchor. */
function hasCustodySupersession(
  checkedOutAt: Date | null,
  events: SupersessionEvent[],
): boolean {
  if (!checkedOutAt) return true;
  return events.some(
    (e) => SUPERSEDING_TYPES.has(e.type) && e.observedAt.getTime() > checkedOutAt.getTime(),
  );
}

/** State-assertion custody: current while checked out with holder and no supersession. */
export function isCustodyAssertionCurrent(
  equipment: Pick<
    EvidenceEquipmentRow,
    "custodyState" | "checkedOutById" | "checkedOutAt"
  >,
  events: SupersessionEvent[],
): boolean {
  if (equipment.custodyState !== "checked_out" || !equipment.checkedOutById) {
    return false;
  }
  return !hasCustodySupersession(equipment.checkedOutAt, events);
}
