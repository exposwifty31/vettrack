// src/hooks/use-display-connection.ts
//
// Board connection tracker — derives a coarse connection state from the shared
// display-snapshot query. Cadence-aware: thresholds are counted in consecutive
// missed polls (TanStack's failureCount, which resets to 0 on any success),
// never in wall-time, so Code Blue's faster 2 s cadence degrades sooner in
// wall-clock terms without any extra timers.
import { useDisplaySnapshotQuery } from "@/hooks/useDisplaySnapshot";
import type { ConnectionState } from "@/features/command-board/board-state";

export const DELAYED_AFTER_MISSED_POLLS = 4;
export const STALE_AFTER_MISSED_POLLS = 24; // ≈2 min at the 5 s cadence
export const OFFLINE_AFTER_MISSED_POLLS = 60;

export interface DisplayConnection {
  state: ConnectionState;
  lastSuccessAt: number | null;
  missedPolls: number;
}

export function useDisplayConnection(): DisplayConnection {
  const query = useDisplaySnapshotQuery();
  const missedPolls = query.failureCount;
  const lastSuccessAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;

  let state: ConnectionState = "live";
  if (missedPolls >= OFFLINE_AFTER_MISSED_POLLS) state = "offline";
  else if (missedPolls >= STALE_AFTER_MISSED_POLLS) state = "stale";
  else if (missedPolls >= DELAYED_AFTER_MISSED_POLLS) state = "delayed";

  return { state, lastSuccessAt, missedPolls };
}
