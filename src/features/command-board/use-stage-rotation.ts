// TV board phase 1 (Task 11) — the Equipment↔Ops stage rotation engine.
//
// Doctrine:
//   - Rotation runs ONLY in the quiet states (attention / all_clear) and only
//     when the Ops view actually has something to show. An empty Ops view is
//     never rotated onto the wall (single-view mode).
//   - "alert" and the takeover states (stale / unconfigured) lock the stage to
//     the equipment view instantly — an exception card is never rotated away
//     from — and rotation resumes (from equipment) once the state clears.
import { useEffect, useState } from "react";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import type { BoardStateKind } from "./board-state";

/** Dwell time per stage view — long enough to read a 10-foot layout twice. */
export const STAGE_ROTATION_MS = 45_000;

export type StageView = "equipment" | "ops";

/**
 * Absent ≠ zero note: an absent waitlist/staging block contributes nothing here
 * (unknown is not content), but OpsStage still renders it as muted-unknown when
 * the view is shown for another reason (e.g. staff on shift).
 */
export function opsHasContent(
  board: EquipmentCommandBoardSnapshot | null | undefined,
  currentShift: readonly unknown[],
): boolean {
  const waitDepth = board?.waitlist?.depth ?? 0;
  const stagingDepth = board?.staging?.depth ?? 0;
  return waitDepth > 0 || stagingDepth > 0 || currentShift.length > 0;
}

export function useStageRotation(opts: {
  state: BoardStateKind;
  opsHasContent: boolean;
}): StageView {
  const rotating =
    opts.opsHasContent && (opts.state === "attention" || opts.state === "all_clear");
  const [view, setView] = useState<StageView>("equipment");

  useEffect(() => {
    if (!rotating) {
      // Lock (alert/takeover) or single-view mode: snap back so the rotation
      // always resumes from the equipment view.
      setView("equipment");
      return;
    }
    const id = setInterval(
      () => setView((v) => (v === "equipment" ? "ops" : "equipment")),
      STAGE_ROTATION_MS,
    );
    return () => clearInterval(id);
  }, [rotating]);

  return rotating ? view : "equipment";
}
