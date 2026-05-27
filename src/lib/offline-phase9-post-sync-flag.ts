/**
 * Opt-in gate for Phase 9 post-sync reconciliation (Stretch-A wiring sketch).
 * Default off — enable with VITE_OFFLINE_PHASE9_POST_SYNC_RECONCILIATION=true.
 */
export const isOfflinePhase9PostSyncReconciliationEnabled =
  import.meta.env.VITE_OFFLINE_PHASE9_POST_SYNC_RECONCILIATION === "true";
