import type { DisplaySnapshot } from "@/types/safety-surfaces";
import type { EquipmentCommandBoardSnapshot } from "../../../shared/equipment-board";
import { countFilledSlots } from "./responsibles-fill";

export type BoardStateKind = "stale" | "unconfigured" | "alert" | "attention" | "all_clear";
export type ConnectionState = "live" | "delayed" | "stale" | "offline";

export interface BoardStateInput {
  snapshot: DisplaySnapshot | undefined;
  connection: ConnectionState;
}

export function hasActiveAlert(board: EquipmentCommandBoardSnapshot | null | undefined): boolean {
  if (!board) return false;
  const unitDown = board.criticalUnits.some((u) => u.status !== "ready" && u.status !== "in_use");
  const powerAlerts = board.power ? board.power.alert > 0 : false;
  return unitDown || powerAlerts;
}

function hasResponsiblesGap(snapshot: DisplaySnapshot): boolean {
  const r = snapshot.responsibles;
  // null/undefined = server-side build failure or pre-deploy server — unknown, NOT a gap.
  if (!r) return false;
  if (snapshot.currentShift.length === 0) return false; // shift data is the schedule source
  // countFilledSlots is the single source of truth for the §4 fill mapping
  // (provisional coordinator statuses and members-without-a-senior both count as
  // filled). Re-deriving it inline here risked drifting from responsibles-fill.ts.
  return countFilledSlots(r) < 5;
}

export function classifyBoardState({ snapshot, connection }: BoardStateInput): BoardStateKind {
  if (connection === "stale" || connection === "offline") return "stale";
  const board = snapshot?.commandBoard;
  // Absent board or zero configured equipment = configuration hole, never good news.
  // unconfigured outranks alert safely: alert inputs derive from configured equipment.
  if (!board || board.overview.totalCritical === 0) return "unconfigured";
  if (hasActiveAlert(board)) return "alert";
  const waitDepth = board.waitlist?.depth ?? 0;
  const stagingDepth = board.staging?.depth ?? 0;
  if (waitDepth > 0 || stagingDepth > 0) return "attention";
  if (snapshot && hasResponsiblesGap(snapshot)) return "attention";
  return "all_clear";
}
