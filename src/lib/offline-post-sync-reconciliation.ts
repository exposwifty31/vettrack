/**
 * Phase 9 post-sync reconciliation wiring sketch (flag-gated).
 *
 * Complements `useRealtimeReconciliation` (visibility / online / SSE gap triggers).
 * Invoked only after `evaluateSyncQueueIdle` reports idle when the feature flag is on.
 *
 * Checkpoints (see docs/offline-first-architecture-plan.md § Phase 9):
 * 1. Replay complete — caller guarantees queue idle before invoke.
 * 2. Authoritative equipment reads — TanStack invalidation (server refetch on subscribe).
 * 3. Dexie repair — not implemented in this sketch; server wins remain a follow-up.
 * 4. Ward / ER / display — `forceResyncWardErCaches` (existing Phase 9 hook path).
 */

import type { QueryClient } from "@tanstack/react-query";
import { forceResyncWardErCaches } from "@/lib/event-reducer";
import { isOfflinePhase9PostSyncReconciliationEnabled } from "./offline-phase9-post-sync-flag";

const EQUIPMENT_LIST_KEYS = [
  ["/api/equipment"],
  ["/api/equipment/my"],
  ["/api/equipment/paginated"],
] as const;

/**
 * Runs Phase 9 checkpoints 2 and 4 when the post-sync flag is enabled.
 * Never throws — reconciliation must not break sync-engine teardown.
 */
export async function runOfflinePhase9PostSyncReconciliation(
  queryClient: QueryClient,
): Promise<void> {
  if (!isOfflinePhase9PostSyncReconciliationEnabled) return;

  try {
    for (const queryKey of EQUIPMENT_LIST_KEYS) {
      await queryClient.invalidateQueries({ queryKey: [...queryKey] });
    }
    await forceResyncWardErCaches(queryClient);
  } catch {
    // Best-effort; sync replay already committed server state.
  }
}
