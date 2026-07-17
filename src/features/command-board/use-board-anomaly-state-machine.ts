import { useEffect, useMemo, useRef } from "react";
import type { BoardAnomaly } from "../../../shared/equipment-board";

/**
 * Dedup key for the single-shot state machine — pinned to `(type, unitId)` so a
 * severity flip on the same unit is the SAME key and never re-fires.
 */
export function boardAnomalyKey(anomaly: Pick<BoardAnomaly, "type" | "unitId">): string {
  return `${anomaly.type}::${anomaly.unitId}`;
}

export interface BoardAnomalyStateMachine {
  /** Keys active on the current snapshot. */
  activeKeys: ReadonlySet<string>;
  /** Keys that transitioned absent → active on THIS snapshot (one-shot escalation). */
  justActivatedKeys: ReadonlySet<string>;
}

/**
 * R-BDF-1.2 — single-shot anomaly state machine over the already-fetched snapshot.
 *
 * Per-key (`(type, unitId)`) lifecycle: `absent → active (fire once) → cleared`. A
 * snapshot where a key no longer appears transitions it to cleared; the key can
 * only re-fire on a subsequent `cleared → active`. `onActivate` fires exactly once
 * per activation — the seam R-BDF-1.3 telemetry hangs its single-shot counter on.
 *
 * No new transport: derives purely from the `anomalies` prop the board already has.
 * A re-render carrying an identical anomaly set (e.g. a calm↔pressure mode flip)
 * changes nothing and never re-fires, because the machine keys only on identity.
 */
export function useBoardAnomalyStateMachine(
  anomalies: readonly BoardAnomaly[],
  onActivate?: (anomaly: BoardAnomaly) => void,
): BoardAnomalyStateMachine {
  // Keys committed on the previous snapshot. Read (not written) during render.
  const knownRef = useRef<Set<string>>(new Set());

  // Stable identity across renders that carry the same set of keys, so the effect
  // below only runs on a genuine membership change.
  const signature = useMemo(
    () =>
      anomalies
        .map(boardAnomalyKey)
        .sort()
        .join("|"),
    [anomalies],
  );

  const activeKeys = useMemo(() => new Set(anomalies.map(boardAnomalyKey)), [signature]);

  // Recomputed every render against the previously-committed set — this is what
  // makes a repeated snapshot "hold" (empty just-activated) rather than re-animate.
  const justActivatedKeys = new Set<string>();
  for (const key of activeKeys) {
    if (!knownRef.current.has(key)) justActivatedKeys.add(key);
  }

  useEffect(() => {
    for (const anomaly of anomalies) {
      if (!knownRef.current.has(boardAnomalyKey(anomaly))) onActivate?.(anomaly);
    }
    knownRef.current = activeKeys;
    // Fire strictly on membership change; onActivate is intentionally read fresh
    // each activation and is not a reactive dependency of the sweep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys]);

  return { activeKeys, justActivatedKeys };
}
