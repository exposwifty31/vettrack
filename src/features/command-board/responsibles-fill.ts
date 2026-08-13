// Responsibles v2 fill mapping (TV board phase 1, spec §4 — binding table).
// A slot is "filled" when someone is accountable, "filled_flagged" when it is
// covered but visibly provisional (members without a senior; a coordinator who
// still needs confirmation), and "empty" otherwise. Flagged counts as filled
// in the N/5 aggregate.
import type {
  BoardCoordinatorStatus,
  BoardResponsibles,
  DoctorTeamBlock,
} from "@/types/safety-surfaces";

export type SlotFill = "filled" | "filled_flagged" | "empty";

export function doctorSlotFill(block: DoctorTeamBlock | undefined): SlotFill {
  if (block?.senior) return "filled";
  if (block && block.members.length > 0) return "filled_flagged";
  return "empty";
}

export function coordinatorSlotFill(status: BoardCoordinatorStatus): SlotFill {
  if (status === "auto" || status === "confirmed") return "filled";
  if (status === "fallback_senior" || status === "needs_confirmation") return "filled_flagged";
  return "empty";
}

/** 0..5 — filled_flagged counts as filled. */
export function countFilledSlots(r: BoardResponsibles): number {
  const fills: SlotFill[] = [
    doctorSlotFill(r.doctors.icu),
    doctorSlotFill(r.doctors.admission),
    doctorSlotFill(r.doctors.internal_medicine),
    r.seniorTechnician != null ? "filled" : "empty",
    coordinatorSlotFill(r.equipmentCoordinator.status),
  ];
  return fills.filter((f) => f !== "empty").length;
}
