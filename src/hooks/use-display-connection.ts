// src/hooks/use-display-connection.ts
//
// Board connection tracker — derives a coarse connection state from the shared
// display-snapshot query. Cadence-aware: thresholds are counted in consecutive
// missed POLL CYCLES, never in wall-time, so Code Blue's faster 2 s cadence
// degrades sooner in wall-clock terms without any extra timers.
//
// Why errorUpdateCount, not failureCount: TanStack resets `failureCount` at
// the START of every fetch dispatch (query-core's "fetch" action applies
// `fetchState()` with `fetchFailureCount: 0`), so it only ever counts retries
// WITHIN one cycle (max retry+1 = 3 at the snapshot query's retry: 2) and can
// never span cycles — a failureCount-based derivation never leaves "live".
// `errorUpdateCount` increments exactly once per failed cycle (after retries
// exhaust) and never resets, so we anchor it at the last success (dataUpdatedAt
// advance) and count forward. Found by the board-states Playwright drill
// (Task 14); the contract is locked in tests/use-display-connection.test.ts.
import { useState } from "react";
import { useDisplaySnapshotQuery } from "@/hooks/useDisplaySnapshot";
import type { ConnectionState } from "@/features/command-board/board-state";

// A failed cycle ≈ 5 s poll interval + 1 s + 2 s retry backoff (retry: 2).
export const DELAYED_AFTER_MISSED_POLLS = 3; // ≈25 s at the 5 s cadence
export const STALE_AFTER_MISSED_POLLS = 15; // ≈2 min
export const OFFLINE_AFTER_MISSED_POLLS = 37; // ≈5 min

export interface DisplayConnection {
  state: ConnectionState;
  lastSuccessAt: number | null;
  missedPolls: number;
}

/**
 * The connection has degraded past "delayed" — the feed can no longer be trusted
 * as live. On a cold boot with no snapshot yet, CommandBoardScreen uses this to
 * swap the loading skeleton for the StaleTakeover, so a wall display shows
 * "server down" instead of a skeleton that spins forever.
 */
export function isConnectionUntrusted(state: ConnectionState): boolean {
  return state === "stale" || state === "offline";
}

interface MissAnchor {
  dataUpdatedAt: number;
  errorUpdateCount: number;
}

export function useDisplayConnection(): DisplayConnection {
  const query = useDisplaySnapshotQuery();

  // Anchor the never-resetting errorUpdateCount at the last success. Render-
  // phase derived-state adjustment (the React-sanctioned pattern): when a new
  // success lands (dataUpdatedAt advanced), re-anchor before committing.
  // Initial anchor: with a success behind us, errors before mount are history,
  // not a current outage; with NO success ever (dataUpdatedAt 0) every error
  // cycle so far IS the current outage — count them all.
  const [anchor, setAnchor] = useState<MissAnchor>({
    dataUpdatedAt: query.dataUpdatedAt,
    errorUpdateCount: query.dataUpdatedAt > 0 ? query.errorUpdateCount : 0,
  });
  let effectiveAnchor = anchor;
  if (query.dataUpdatedAt !== anchor.dataUpdatedAt) {
    effectiveAnchor = {
      dataUpdatedAt: query.dataUpdatedAt,
      errorUpdateCount: query.errorUpdateCount,
    };
    setAnchor(effectiveAnchor);
  }

  const missedPolls = Math.max(0, query.errorUpdateCount - effectiveAnchor.errorUpdateCount);
  const lastSuccessAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;

  let state: ConnectionState = "live";
  if (missedPolls >= OFFLINE_AFTER_MISSED_POLLS) state = "offline";
  else if (missedPolls >= STALE_AFTER_MISSED_POLLS) state = "stale";
  else if (missedPolls >= DELAYED_AFTER_MISSED_POLLS) state = "delayed";

  return { state, lastSuccessAt, missedPolls };
}
