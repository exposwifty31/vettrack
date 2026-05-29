import fs from "fs";
import path from "path";
import { getRuntimeReadiness } from "../jobs/runtime-readiness.js";
import { getAliveCount as getDisplayHeartbeatsAlive } from "./display-heartbeat-store.js";

type MetricName =
  | "tasks_created"
  | "tasks_started"
  | "tasks_completed"
  | "automation_triggered"
  | "automation_executed"
  | "notifications_sent"
  | "notifications_failed"
  | "queue_jobs_enqueued"
  | "queue_jobs_started"
  | "queue_jobs_completed"
  | "queue_jobs_failed"
  | "queue_jobs_dead_letter"
  | "idempotency_hits"
  | "circuit_breaker_opened"
  | "retries_attempted"
  | "realtime_connections"
  | "realtime_events_sent"
  | "realtime_duplicate_drops"
  | "realtime_gap_resync"
  | "outbox_failed_publish_attempts"
  | "recommendations_generated"
  | "suggestions_triggered"
  | "recommendations_shown"
  | "suggestions_suppressed"
  | "scoring_runs"
  | "er_mode_fail_open"
  | "authority_resolution_source_check_in"
  | "authority_resolution_source_shift"
  | "authority_resolution_source_no_active_shift"
  | "authority_denied_role_not_in_allow"
  | "authority_denied_legacy_fallback_not_matched"
  | "authority_legacy_fallback_used"
  | "authority_drift_role"
  | "authority_drift_shift_lookup_failed"
  | "authority_resolution_failed"
  | "authority_oprole_shadow_scheduled"
  | "authority_oprole_shadow_deduped"
  | "authority_oprole_shadow_throttled"
  | "authority_oprole_shadow_ran"
  | "authority_oprole_shadow_match"
  | "authority_oprole_shadow_drift_revoked"
  | "authority_oprole_shadow_user_missing"
  | "authority_oprole_shadow_runner_failed"
  | "authority_cache_disabled"
  | "authority_cache_checkin_hit"
  | "authority_cache_checkin_miss"
  | "authority_cache_shift_hit"
  | "authority_cache_shift_miss"
  | "authority_cache_inflight_hit"
  | "authority_cache_invalidate_checkin"
  | "authority_cache_invalidate_shift"
  | "authority_cache_invalidate_clinic_shift"
  | "authority_cache_evicted"
  | "authority_cache_stale_write_dropped"
  | "authority_cache_error_get"
  | "authority_cache_error_set"
  | "authority_cache_invalidate_error"
  | "authority_cache_allowlist_hit"
  | "authority_cache_allowlist_miss"
  | "authority_cache_allowlist_error"
  | "authority_cache_invalidate_allowlist"
  | "authority_stale_would_have_denied"
  | "authority_stale_denied"
  | "authority_stale_skipped_legacy_path"
  | "authority_oprole_denied"
  // Phase 3 PR 3.2 — task-ownership backfill counters (incremented by the worker).
  | "task_ownership_backfill_scanned"
  | "task_ownership_backfill_auto_resolved_id"
  | "task_ownership_backfill_auto_resolved_clerk_id"
  | "task_ownership_backfill_queued_no_candidate"
  | "task_ownership_backfill_queued_cross_clinic"
  | "task_ownership_backfill_queued_blocked"
  | "task_ownership_backfill_queued_deleted"
  | "task_ownership_backfill_queued_ambiguous"
  | "task_ownership_backfill_skipped"
  | "task_ownership_backfill_error"
  // Phase 3 PR 3.2 — ongoing read-path skeletons. INTENTIONALLY NOT INCREMENTED
  // by any PR 3.2 code path. A later PR will instrument the service path.
  | "task_ownership_typed"
  | "task_ownership_string_only"
  // Phase 3 PR 3.3 — task-assignment evaluator counters. Shadow-mode "would
  // have denied" buckets per reason, plus enforce-mode "denied" buckets per
  // reason. Foundation-only: PR 3.3 wires the evaluator but no route binds
  // it yet (that's PR 3.4). Counters move only when an explicit test or a
  // future caller invokes the evaluator.
  | "task_assignment_enforce_would_have_denied_actor_role"
  | "task_assignment_enforce_would_have_denied_target_cross_clinic"
  | "task_assignment_enforce_would_have_denied_target_not_active"
  | "task_assignment_enforce_would_have_denied_target_role"
  | "task_assignment_enforce_would_have_denied_exclusivity"
  | "task_assignment_enforce_denied_actor_role"
  | "task_assignment_enforce_denied_target_cross_clinic"
  | "task_assignment_enforce_denied_target_not_active"
  | "task_assignment_enforce_denied_target_role"
  | "task_assignment_enforce_denied_exclusivity"
  // Phase 3 PR 3.6 — stale-task-ownership evaluator + sweeper counters.
  // Foundation-only: PR 3.6 ships the evaluator and sweeper as fully inert
  // (off-default). Counters move only when an explicit test invokes the
  // evaluator, or when PR 3.7 wires it into shadow.
  | "stale_task_ownership_scanned"
  | "stale_task_ownership_would_have_revoked"
  | "stale_task_ownership_active_treatment_protected"
  | "stale_task_ownership_emergency_suspend_skip"
  | "stale_task_ownership_degraded_mode_pause"
  | "stale_task_ownership_lease_contention_retry"
  // Tombstone counter (PR 3.6). Asserted to remain 0 in PR 3.6 tests. If
  // it ever increments in production, an isolation invariant has been
  // broken (PR 3.6 SHIPS the verdict-shape code for the enforce branch
  // but ships NO consumer of it; live revocation is PR 3.8 scope).
  | "stale_task_ownership_revoked"
  // Phase 4 PR 4.1 — Code Blue manager authority enforcement counters.
  // Foundation-only: PR 4.1 registers all counters; only the evaluator
  // increments them in PR 4.1 (via explicit test invocations). Wiring lands
  // in PR 4.2 (initiation), PR 4.3 (end), PR 4.5 (per-clinic enforce flip).
  | "code_blue_initiator_authority_denied"
  | "code_blue_manager_authority_allow"
  | "code_blue_manager_authority_mode_inactive_strategy_a"
  | "code_blue_manager_authority_fault_open"
  | "code_blue_manager_authority_shadow_denied_oprole_not_in_allowlist"
  | "code_blue_manager_authority_shadow_denied_no_open_check_in"
  | "code_blue_manager_authority_shadow_denied_manager_cross_clinic"
  | "code_blue_manager_authority_shadow_denied_user_missing"
  | "code_blue_manager_authority_denied_oprole_not_in_allowlist"
  | "code_blue_manager_authority_denied_no_open_check_in"
  | "code_blue_manager_authority_denied_manager_cross_clinic"
  | "code_blue_manager_authority_denied_user_missing"
  // Tombstone (PR 4.1). PR 4.3 increments this when init→end manager
  // eligibility crosses — the headline Phase 4 signal. Asserted 0 in
  // PR 4.1 tests.
  | "code_blue_manager_drift_between_init_and_end"
  // Phase 4 PR 4.4a — mid-session manager-downgrade shadow detection.
  // Incremented from POST /api/code-blue/sessions/:id/logs when the
  // persisted manager's authority is no longer Code-Blue-eligible at
  // log-write time. Shadow-only; never blocks the log write. Reason
  // codes mirror the master plan's manager deny-reason union.
  | "code_blue_manager_midsession_shadow_denied_oprole_not_in_allowlist"
  | "code_blue_manager_midsession_shadow_denied_no_open_check_in"
  // Phase 4 PR 4.4b — drug/shock actor oprole shadow detection.
  // Incremented from POST /api/code-blue/sessions/:id/logs for category ∈
  // {drug, shock} based on the request actor's own snapshot. Shadow-only
  // in PR 4.4b. The actor's snapshot is set by requireClinicalAuthority
  // middleware (PR 4.4a) so no separate DB lookup is needed.
  | "code_blue_log_drug_shock_actor_authority_allow"
  | "code_blue_log_drug_shock_actor_authority_mode_inactive_strategy_a"
  | "code_blue_log_drug_shock_actor_authority_shadow_denied_oprole_not_in_allowlist"
  | "code_blue_log_drug_shock_actor_authority_shadow_denied_no_open_check_in"
  // Phase 4 PR 4.5 — drug/shock actor oprole enforce-mode denied counters.
  // Distinct from the shadow counters above so dashboards can separate
  // observation from enforcement-driven denials.
  | "code_blue_log_drug_shock_actor_authority_denied_oprole_not_in_allowlist"
  | "code_blue_log_drug_shock_actor_authority_denied_no_open_check_in"
  // Phase 5 PR 5.1 — clinical-invariant evaluator family resolved-mode
  // counters. Foundation only: PR 5.1 adds the union literals + zero
  // initializers; nothing increments them yet. PR 5.3 / 5.4 wiring is
  // the first caller (off-mode increment on the request path).
  | "clinical_invariant_resolved_off"
  | "clinical_invariant_resolved_shadow"
  | "clinical_invariant_resolved_enforce"
  // Phase 5 PR 5.2 — clinical-invariant shadow-observation counters.
  // `_would_have_blocked` ticks once per shadow-mode request that
  // produces non-empty `orphanLines`. Per-reason counters tick once
  // per unique `OrphanReasonCode` observed in that request (not per
  // orphan line — matches the `(reason, mode)` cardinality contract).
  | "clinical_invariant_would_have_blocked"
  | "clinical_invariant_would_have_blocked_no_patient_linked"
  | "clinical_invariant_would_have_blocked_no_active_hospitalization"
  | "clinical_invariant_would_have_blocked_no_active_order"
  | "clinical_invariant_would_have_blocked_quantity_exceeds_order"
  // Phase 5 PR 5.7 — clinical-invariant enforce-mode counters.
  // `_blocked_total` ticks once per enforce-mode 422 deny. Per-reason
  // `_orphan_reason_*` counters tick once per unique reason in the
  // request (set semantics, matching the shadow counter contract).
  // `_emergency_bypass_total` ticks when the carve-out fires.
  // `_fail_open_total` / `_fail_closed_total` tick on the
  // SMART_COP_VALIDATION_FAIL_OPEN dispatch paths.
  // `_evaluator_failure_total` ticks once per evaluator-side throw
  // (caught at the wiring's Strategy A safety net per CI-16).
  | "clinical_invariant_blocked_total"
  | "clinical_invariant_orphan_reason_no_patient_linked"
  | "clinical_invariant_orphan_reason_no_active_hospitalization"
  | "clinical_invariant_orphan_reason_no_active_order"
  | "clinical_invariant_orphan_reason_quantity_exceeds_order"
  | "clinical_invariant_emergency_bypass_total"
  | "clinical_invariant_fail_open_total"
  | "clinical_invariant_fail_closed_total"
  | "clinical_invariant_evaluator_failure_total"
  // Phase 9 PR 9.2 — Department Display heartbeat + kiosk wake-lock.
  // Bounded enum labels are encoded as separate counter names (the existing
  // pattern). The kiosk_mode label of `display_heartbeats_received_total`
  // from §3.9 is fanned out into _kiosk and _non_kiosk counters.
  | "display_heartbeats_received_kiosk"
  | "display_heartbeats_received_non_kiosk"
  | "display_wake_lock_reacquire_exhausted"
  // Phase 9 PR 9.4 — Code Blue runtime reliability.
  // Bounded enum labels from §3.9 are fanned out into individual counter
  // names. No PII / userId / clinicId / requestId labels.
  | "realtime_reconnect_storm_detected"
  | "realtime_emergency_degraded"
  | "realtime_emergency_degraded_recovered"
  | "code_blue_wake_recovery"
  | "code_blue_snapshot_fallback"
  | "code_blue_propagation_observed_lt_1s"
  | "code_blue_propagation_observed_lt_3s"
  | "code_blue_propagation_observed_lt_15s"
  | "code_blue_propagation_observed_gte_15s"
  // Phase 9 PR 9.5 — offline emergency mutation blocking.
  // Bounded endpoint_class enum fanned out into individual counters.
  | "offline_emergency_mutation_blocked_start"
  | "offline_emergency_mutation_blocked_log"
  | "offline_emergency_mutation_blocked_end"
  | "offline_emergency_mutation_blocked_presence"
  // Phase 9 PR 9.7 — observability fan-out for the remaining §3.9 counters.
  // All labels are encoded as separate counter names (no Prometheus labels).
  | "display_forced_resync_visibility"
  | "display_forced_resync_pageshow"
  | "display_forced_resync_online"
  | "display_forced_resync_version_mismatch"
  | "display_forced_resync_gap"
  | "display_forced_resync_peer_ahead"
  | "display_forced_resync_emergency_uncertain"
  | "split_version_client_detected"
  | "sw_update_conflict"
  | "sw_forced_reload_active"
  | "sw_forced_reload_idle"
  | "sw_forced_reload_kiosk"
  | "sw_forced_reload_loop_suppressed"
  | "telemetry_payload_rejected_enum_mismatch"
  | "telemetry_payload_rejected_shape"
  // Tombstone — declared per plan §3.9 bounded enum
  // `telemetry_payload_rejected_total{reason="enum_mismatch|shape|rate_limit"}`
  // but never incremented by Phase 9. The telemetry endpoint relies on
  // the global per-IP API limiter for rate enforcement; that path returns
  // 429 before reaching the handler and is not counted here. A future PR
  // that adds endpoint-local rate limiting (e.g. per-displaySessionId
  // throttling that returns 200 + drops to this counter) will wire the
  // increment. Until then dashboards must treat this value as
  // "rate-limit drops counted at the handler" — not "no rate limiting
  // active". Documented here so operators don't misread a 0.
  | "telemetry_payload_rejected_rate_limit"
  // OFF-08 — bounded offline sync queue telemetry (client Dexie aggregates).
  | "offline_sync_pending_reported_zero"
  | "offline_sync_pending_reported_one"
  | "offline_sync_pending_reported_two_to_five"
  | "offline_sync_pending_reported_six_plus"
  | "offline_sync_oldest_pending_none"
  | "offline_sync_oldest_pending_lt_60s"
  | "offline_sync_oldest_pending_lt_5m"
  | "offline_sync_oldest_pending_lt_1h"
  | "offline_sync_oldest_pending_gte_1h"
  | "offline_sync_dead_letter_zero"
  | "offline_sync_dead_letter_one"
  | "offline_sync_dead_letter_two_plus"
  | "offline_sync_conflict_zero"
  | "offline_sync_conflict_one_plus"
  | "offline_sync_session_success_zero"
  | "offline_sync_session_success_one_to_five"
  | "offline_sync_session_success_six_plus"
  | "offline_sync_session_conflict_zero"
  | "offline_sync_session_conflict_one_to_five"
  | "offline_sync_session_conflict_six_plus"
  | "offline_sync_session_dead_zero"
  | "offline_sync_session_dead_one_to_five"
  | "offline_sync_session_dead_six_plus"
  | "offline_sync_idempotency_replay_served"
  | "offline_sync_permanent_failure"
  | "offline_sync_circuit_open"
  // F1b-1 — job registry / idempotency bounded server counters (no labels).
  | "replay_idempotency_collision"
  | "job_runtime_unknown_job_name"
  | "legacy_worker_starter_used"
  | "job_runtime_worker_unavailable"
  | "job_enqueue_queue_unavailable"
  | "job_enqueue_succeeded"
  | "rfid_batch_received"
  | "rfid_batch_rejected_signature"
  | "rfid_batch_rejected_schema"
  | "rfid_batch_rejected_flag_off"
  | "rfid_event_unknown_tag"
  | "rfid_event_unknown_gateway"
  | "rfid_event_stale"
  | "rfid_event_unchanged"
  | "rfid_event_room_changed"
  | "semi_dock_notified"
  | "semi_dock_skipped_deduped"
  | "dock_return_nfc_confirmed";

type MetricBuckets = Record<MetricName, number>;

export interface MetricsSnapshot {
  tasks: {
    created: number;
    started: number;
    completed: number;
  };
  automation: {
    triggered: number;
    executed: number;
  };
  notifications: {
    sent: number;
    failed: number;
  };
  queue: {
    enqueued: number;
    started: number;
    completed: number;
    failed: number;
    deadLetter: number;
  };
  reliability: {
    idempotencyHits: number;
    circuitBreakerOpened: number;
    retriesAttempted: number;
    /** Increments when ER allowlist middleware fails closed resolver and fails open (see ER_MODE_FAIL_OPEN_COUNT). */
    erModeFailOpenCount: number;
  };
  realtime: {
    connections: number;
    eventsSent: number;
    duplicateDrops: number;
    gapResyncs: number;
    /** Batched publisher loop failures (see event-publisher). */
    outboxFailedPublishAttempts: number;
  };
  intelligence: {
    recommendationsGenerated: number;
    suggestionsTriggered: number;
    recommendationsShown: number;
    suggestionsSuppressed: number;
    scoringRuns: number;
  };
  authority: {
    resolutionSource: {
      checkIn: number;
      shift: number;
      noActiveShift: number;
    };
    denied: {
      roleNotInAllow: number;
      legacyFallbackNotMatched: number;
    };
    legacyFallbackUsed: number;
    drift: {
      role: number;
      shiftLookupFailed: number;
    };
    resolutionFailed: number;
    oproleShadow: {
      scheduled: number;
      deduped: number;
      throttled: number;
      ran: number;
      match: number;
      driftRevoked: number;
      userMissing: number;
      runnerFailed: number;
    };
    cache: {
      disabled: number;
      checkInHit: number;
      checkInMiss: number;
      shiftHit: number;
      shiftMiss: number;
      inflightHit: number;
      invalidateCheckIn: number;
      invalidateShift: number;
      invalidateClinicShift: number;
      evicted: number;
      staleWriteDropped: number;
      errorGet: number;
      errorSet: number;
      invalidateError: number;
      allowlistHit: number;
      allowlistMiss: number;
      allowlistError: number;
      invalidateAllowlist: number;
    };
    /** Phase 2.5 PR 7 — stale check-in enforcement (off | shadow | enforce). */
    staleEnforce: {
      wouldHaveDenied: number;
      denied: number;
      skippedLegacyPath: number;
    };
    /** Phase 2.5 PR 7 — operationalRole enforcement (off | enforce only). Shadow signal is owned by PR 5.3 oproleShadow. */
    oproleEnforce: {
      denied: number;
    };
  };
  /** Phase 3 PR 3.2 — typed task-ownership backfill counters. */
  taskOwnership: {
    backfill: {
      scanned: number;
      autoResolvedById: number;
      autoResolvedByClerkId: number;
      queuedNoCandidate: number;
      queuedCrossClinic: number;
      queuedBlocked: number;
      queuedDeleted: number;
      queuedAmbiguous: number;
      skipped: number;
      error: number;
    };
    /** Skeleton counters — registered now, incremented only by a future PR that instruments the service read path. */
    readPath: {
      typed: number;
      stringOnly: number;
    };
  };
  /** Phase 3 PR 3.6 — stale-task-ownership evaluator + sweeper counters. */
  staleTaskOwnership: {
    scanned: number;
    wouldHaveRevoked: number;
    activeTreatmentProtected: number;
    emergencySuspendSkip: number;
    degradedModePause: number;
    leaseContentionRetry: number;
    /** Tombstone — never incremented by PR 3.6. */
    revoked: number;
  };
  /** Phase 3 PR 3.3 — task-assignment evaluator counters. */
  taskAssignmentEnforce: {
    wouldHaveDenied: {
      actorRole: number;
      targetCrossClinic: number;
      targetNotActive: number;
      targetRole: number;
      exclusivity: number;
    };
    denied: {
      actorRole: number;
      targetCrossClinic: number;
      targetNotActive: number;
      targetRole: number;
      exclusivity: number;
    };
  };
  /**
   * Phase 4 PR 4.1 — Code Blue authority enforcement counters.
   *
   * `manager.driftBetweenInitAndEnd` is the headline Phase 4 signal —
   * incremented (PR 4.3+) when initiation evaluator would have allowed but
   * end evaluator would deny.
   *
   * `initiator.denied` is incremented by PR 4.2 wiring at the actor
   * clinical-gate denial site. In PR 4.1 it is a tombstone.
   *
   * Drug/shock-family and mid-session counters are NOT in PR 4.1 scope;
   * they will be added by PR 4.4a / PR 4.4b in their own additive PRs.
   */
  codeBlue: {
    initiator: {
      denied: number;
    };
    manager: {
      allow: number;
      modeInactiveStrategyA: number;
      faultOpen: number;
      driftBetweenInitAndEnd: number;
      shadowWouldHaveDenied: {
        oproleNotInAllowlist: number;
        noOpenCheckIn: number;
        managerCrossClinic: number;
        userMissing: number;
      };
      denied: {
        oproleNotInAllowlist: number;
        noOpenCheckIn: number;
        managerCrossClinic: number;
        userMissing: number;
      };
      /**
       * Phase 4 PR 4.4a — mid-session manager-downgrade shadow detection.
       * Incremented from POST /api/code-blue/sessions/:id/logs. Shadow-only;
       * never blocks. Distinct from the regular shadowWouldHaveDenied
       * counters so dashboards can separate "init/end shadow" from
       * "mid-session log-write shadow" signals.
       */
      midsessionShadowDenied: {
        oproleNotInAllowlist: number;
        noOpenCheckIn: number;
      };
    };
    /**
     * Phase 4 PR 4.4b — drug/shock actor oprole shadow detection.
     * Incremented from POST /api/code-blue/sessions/:id/logs for
     * category ∈ {drug, shock} based on the request actor's own snapshot.
     * Distinct from the manager-family counters because this signal is
     * about who is RECORDING the drug/shock event, not about the persisted
     * resuscitation manager.
     */
    logDrugShockActor: {
      allow: number;
      modeInactiveStrategyA: number;
      shadowWouldHaveDenied: {
        oproleNotInAllowlist: number;
        noOpenCheckIn: number;
      };
      /**
       * Phase 4 PR 4.5 — enforce-mode denied counters. Distinct from
       * shadowWouldHaveDenied so dashboards can separate observation
       * from enforcement-driven denials. Per-clinic vt_server_config
       * key `code_blue.log_drug_shock_enforce.<clinicId>` = "enforce"
       * activates this path.
       */
      denied: {
        oproleNotInAllowlist: number;
        noOpenCheckIn: number;
      };
    };
  };
  /**
   * Phase 5 PR 5.1 — clinical-invariant evaluator family counters.
   *
   * Foundation only. PR 5.1 wires the resolver and ships the
   * resolved-mode counters; no caller increments them yet. PR 5.3 /
   * 5.4 (dispense-confirm / container-dispense wiring) are the first
   * callers — they tick `resolved.off` on the request path with the
   * env default `COP_CLINICAL_INVARIANT_ENFORCE_V1=off`.
   *
   * Per Phase 5 plan §13 narrow-scope rule, the clinical-invariant
   * family is operationally co-located with the authority enforcement
   * framework only — it is NOT an authority evaluator (CI-14). The
   * snapshot keeps it in its own top-level section so dashboards can
   * track it independently from `authority`, `staleTaskOwnership`,
   * `taskAssignmentEnforce`, and `codeBlue`.
   */
  clinicalInvariant: {
    resolved: {
      off: number;
      shadow: number;
      enforce: number;
    };
    /**
     * Phase 5 PR 5.2 — shadow-observation counters. `total` ticks once
     * per shadow-mode request with non-empty `orphanLines`; per-reason
     * fields tick once per unique `OrphanReasonCode` observed in that
     * request.
     */
    shadowWouldHaveBlocked: {
      total: number;
      noPatientLinked: number;
      noActiveHospitalization: number;
      noActiveOrder: number;
      quantityExceedsOrder: number;
    };
    /**
     * Phase 5 PR 5.7 — enforce-mode counters. `blockedTotal` ticks
     * once per 422 deny; `orphanReason.*` per unique reason in the
     * request. `emergencyBypassTotal` ticks when the carve-out
     * fires. `failOpenTotal` / `failClosedTotal` tick on the
     * `SMART_COP_VALIDATION_FAIL_OPEN` dispatch. `evaluatorFailureTotal`
     * ticks once per evaluator-side throw caught at the wiring layer.
     */
    blockedTotal: number;
    orphanReason: {
      noPatientLinked: number;
      noActiveHospitalization: number;
      noActiveOrder: number;
      quantityExceedsOrder: number;
    };
    emergencyBypassTotal: number;
    failOpenTotal: number;
    failClosedTotal: number;
    evaluatorFailureTotal: number;
  };
  /** Phase 9 PR 9.2 — Department Display heartbeat + kiosk wake-lock. */
  display: {
    heartbeats: {
      received: {
        kiosk: number;
        nonKiosk: number;
      };
      /** Gauge: distinct sessions with an accepted heartbeat in the last 60s. */
      alive: number;
    };
    wakeLock: {
      reacquireExhausted: number;
    };
  };
  /** Phase 9 PR 9.4 — Code Blue runtime reliability. */
  phase9Realtime: {
    reconnectStormDetected: number;
    emergencyDegraded: number;
    emergencyDegradedRecovered: number;
  };
  phase9CodeBlue: {
    wakeRecovery: number;
    snapshotFallback: number;
    propagationObserved: {
      lt_1s: number;
      lt_3s: number;
      lt_15s: number;
      gte_15s: number;
    };
  };
  /** Phase 9 PR 9.5 — offline emergency mutation blocking. */
  phase9OfflineEmergency: {
    blocked: {
      start: number;
      log: number;
      end: number;
      presence: number;
    };
  };
  /** Phase 9 PR 9.7 — observability fan-out. */
  phase9Observability: {
    displayForcedResync: {
      visibility: number;
      pageshow: number;
      online: number;
      versionMismatch: number;
      gap: number;
      peerAhead: number;
      emergencyUncertain: number;
    };
    splitVersionClientDetected: number;
    swUpdateConflict: number;
    swForcedReload: {
      active: number;
      idle: number;
      kiosk: number;
    };
    swForcedReloadLoopSuppressed: number;
    telemetryPayloadRejected: {
      enumMismatch: number;
      shape: number;
      rateLimit: number;
    };
  };
  /** OFF-08 — client-reported Dexie queue health (bounded buckets only). */
  offlineSync: {
    pendingReported: {
      zero: number;
      one: number;
      twoToFive: number;
      sixPlus: number;
    };
    oldestPendingAge: {
      none: number;
      lt60s: number;
      lt5m: number;
      lt1h: number;
      gte1h: number;
    };
    deadLetter: {
      zero: number;
      one: number;
      twoPlus: number;
    };
    conflict: {
      zero: number;
      onePlus: number;
    };
    sessionSuccess: {
      zero: number;
      oneToFive: number;
      sixPlus: number;
    };
    sessionConflict: {
      zero: number;
      oneToFive: number;
      sixPlus: number;
    };
    sessionDead: {
      zero: number;
      oneToFive: number;
      sixPlus: number;
    };
    idempotencyReplayServed: number;
    engine: {
      permanentFailure: number;
      circuitOpen: number;
    };
  };
  /** F1b-1 — job registry / equipment replay idempotency (bounded names only). */
  jobRegistry: {
    replayIdempotencyCollision: number;
    jobRuntimeUnknownJobName: number;
    legacyWorkerStarterUsed: number;
    jobRuntimeWorkerUnavailable: number;
    jobEnqueueQueueUnavailable: number;
    jobEnqueueSucceeded: number;
    /** F2b — live pilot runtime readiness (not a counter). */
    runtimeReadiness: {
      started: boolean;
      workers: Array<{ name: string; ok: boolean }>;
    };
  };
  timestamp: string;
}

const DEFAULT_COUNTERS: MetricBuckets = {
  tasks_created: 0,
  tasks_started: 0,
  tasks_completed: 0,
  automation_triggered: 0,
  automation_executed: 0,
  notifications_sent: 0,
  notifications_failed: 0,
  queue_jobs_enqueued: 0,
  queue_jobs_started: 0,
  queue_jobs_completed: 0,
  queue_jobs_failed: 0,
  queue_jobs_dead_letter: 0,
  idempotency_hits: 0,
  circuit_breaker_opened: 0,
  retries_attempted: 0,
  realtime_connections: 0,
  realtime_events_sent: 0,
  realtime_duplicate_drops: 0,
  realtime_gap_resync: 0,
  outbox_failed_publish_attempts: 0,
  recommendations_generated: 0,
  suggestions_triggered: 0,
  recommendations_shown: 0,
  suggestions_suppressed: 0,
  scoring_runs: 0,
  er_mode_fail_open: 0,
  authority_resolution_source_check_in: 0,
  authority_resolution_source_shift: 0,
  authority_resolution_source_no_active_shift: 0,
  authority_denied_role_not_in_allow: 0,
  authority_denied_legacy_fallback_not_matched: 0,
  authority_legacy_fallback_used: 0,
  authority_drift_role: 0,
  authority_drift_shift_lookup_failed: 0,
  authority_resolution_failed: 0,
  authority_oprole_shadow_scheduled: 0,
  authority_oprole_shadow_deduped: 0,
  authority_oprole_shadow_throttled: 0,
  authority_oprole_shadow_ran: 0,
  authority_oprole_shadow_match: 0,
  authority_oprole_shadow_drift_revoked: 0,
  authority_oprole_shadow_user_missing: 0,
  authority_oprole_shadow_runner_failed: 0,
  authority_cache_disabled: 0,
  authority_cache_checkin_hit: 0,
  authority_cache_checkin_miss: 0,
  authority_cache_shift_hit: 0,
  authority_cache_shift_miss: 0,
  authority_cache_inflight_hit: 0,
  authority_cache_invalidate_checkin: 0,
  authority_cache_invalidate_shift: 0,
  authority_cache_invalidate_clinic_shift: 0,
  authority_cache_evicted: 0,
  authority_cache_stale_write_dropped: 0,
  authority_cache_error_get: 0,
  authority_cache_error_set: 0,
  authority_cache_invalidate_error: 0,
  authority_cache_allowlist_hit: 0,
  authority_cache_allowlist_miss: 0,
  authority_cache_allowlist_error: 0,
  authority_cache_invalidate_allowlist: 0,
  authority_stale_would_have_denied: 0,
  authority_stale_denied: 0,
  authority_stale_skipped_legacy_path: 0,
  authority_oprole_denied: 0,
  task_ownership_backfill_scanned: 0,
  task_ownership_backfill_auto_resolved_id: 0,
  task_ownership_backfill_auto_resolved_clerk_id: 0,
  task_ownership_backfill_queued_no_candidate: 0,
  task_ownership_backfill_queued_cross_clinic: 0,
  task_ownership_backfill_queued_blocked: 0,
  task_ownership_backfill_queued_deleted: 0,
  task_ownership_backfill_queued_ambiguous: 0,
  task_ownership_backfill_skipped: 0,
  task_ownership_backfill_error: 0,
  // Skeleton — never incremented by PR 3.2. A later PR will instrument the service path.
  task_ownership_typed: 0,
  task_ownership_string_only: 0,
  // Phase 3 PR 3.3 — task-assignment evaluator counters.
  task_assignment_enforce_would_have_denied_actor_role: 0,
  task_assignment_enforce_would_have_denied_target_cross_clinic: 0,
  task_assignment_enforce_would_have_denied_target_not_active: 0,
  task_assignment_enforce_would_have_denied_target_role: 0,
  task_assignment_enforce_would_have_denied_exclusivity: 0,
  task_assignment_enforce_denied_actor_role: 0,
  task_assignment_enforce_denied_target_cross_clinic: 0,
  task_assignment_enforce_denied_target_not_active: 0,
  task_assignment_enforce_denied_target_role: 0,
  task_assignment_enforce_denied_exclusivity: 0,
  stale_task_ownership_scanned: 0,
  stale_task_ownership_would_have_revoked: 0,
  stale_task_ownership_active_treatment_protected: 0,
  stale_task_ownership_emergency_suspend_skip: 0,
  stale_task_ownership_degraded_mode_pause: 0,
  stale_task_ownership_lease_contention_retry: 0,
  // Tombstone — never incremented by PR 3.6. PR 3.8 scope.
  stale_task_ownership_revoked: 0,
  // Phase 4 PR 4.1 — Code Blue manager authority enforcement counters.
  code_blue_initiator_authority_denied: 0,
  code_blue_manager_authority_allow: 0,
  code_blue_manager_authority_mode_inactive_strategy_a: 0,
  code_blue_manager_authority_fault_open: 0,
  code_blue_manager_authority_shadow_denied_oprole_not_in_allowlist: 0,
  code_blue_manager_authority_shadow_denied_no_open_check_in: 0,
  code_blue_manager_authority_shadow_denied_manager_cross_clinic: 0,
  code_blue_manager_authority_shadow_denied_user_missing: 0,
  code_blue_manager_authority_denied_oprole_not_in_allowlist: 0,
  code_blue_manager_authority_denied_no_open_check_in: 0,
  code_blue_manager_authority_denied_manager_cross_clinic: 0,
  code_blue_manager_authority_denied_user_missing: 0,
  // Tombstone — incremented by PR 4.3 wiring.
  code_blue_manager_drift_between_init_and_end: 0,
  // Phase 4 PR 4.4a — mid-session manager-downgrade shadow detection.
  code_blue_manager_midsession_shadow_denied_oprole_not_in_allowlist: 0,
  code_blue_manager_midsession_shadow_denied_no_open_check_in: 0,
  // Phase 4 PR 4.4b — drug/shock actor oprole shadow detection.
  code_blue_log_drug_shock_actor_authority_allow: 0,
  code_blue_log_drug_shock_actor_authority_mode_inactive_strategy_a: 0,
  code_blue_log_drug_shock_actor_authority_shadow_denied_oprole_not_in_allowlist: 0,
  code_blue_log_drug_shock_actor_authority_shadow_denied_no_open_check_in: 0,
  // Phase 4 PR 4.5 — drug/shock actor oprole enforce-mode denied counters.
  code_blue_log_drug_shock_actor_authority_denied_oprole_not_in_allowlist: 0,
  code_blue_log_drug_shock_actor_authority_denied_no_open_check_in: 0,
  // Phase 5 PR 5.1 — clinical-invariant resolved-mode counters.
  clinical_invariant_resolved_off: 0,
  clinical_invariant_resolved_shadow: 0,
  clinical_invariant_resolved_enforce: 0,
  // Phase 5 PR 5.2 — clinical-invariant shadow-observation counters.
  clinical_invariant_would_have_blocked: 0,
  clinical_invariant_would_have_blocked_no_patient_linked: 0,
  clinical_invariant_would_have_blocked_no_active_hospitalization: 0,
  clinical_invariant_would_have_blocked_no_active_order: 0,
  clinical_invariant_would_have_blocked_quantity_exceeds_order: 0,
  // Phase 5 PR 5.7 — clinical-invariant enforce-mode counters.
  clinical_invariant_blocked_total: 0,
  clinical_invariant_orphan_reason_no_patient_linked: 0,
  clinical_invariant_orphan_reason_no_active_hospitalization: 0,
  clinical_invariant_orphan_reason_no_active_order: 0,
  clinical_invariant_orphan_reason_quantity_exceeds_order: 0,
  clinical_invariant_emergency_bypass_total: 0,
  clinical_invariant_fail_open_total: 0,
  clinical_invariant_fail_closed_total: 0,
  clinical_invariant_evaluator_failure_total: 0,
  // Phase 9 PR 9.2 — Department Display heartbeat + kiosk wake-lock.
  display_heartbeats_received_kiosk: 0,
  display_heartbeats_received_non_kiosk: 0,
  display_wake_lock_reacquire_exhausted: 0,
  // Phase 9 PR 9.4 — Code Blue runtime reliability.
  realtime_reconnect_storm_detected: 0,
  realtime_emergency_degraded: 0,
  realtime_emergency_degraded_recovered: 0,
  code_blue_wake_recovery: 0,
  code_blue_snapshot_fallback: 0,
  code_blue_propagation_observed_lt_1s: 0,
  code_blue_propagation_observed_lt_3s: 0,
  code_blue_propagation_observed_lt_15s: 0,
  code_blue_propagation_observed_gte_15s: 0,
  // Phase 9 PR 9.5 — offline emergency mutation blocking.
  offline_emergency_mutation_blocked_start: 0,
  offline_emergency_mutation_blocked_log: 0,
  offline_emergency_mutation_blocked_end: 0,
  offline_emergency_mutation_blocked_presence: 0,
  // Phase 9 PR 9.7 — observability fan-out for the remaining §3.9 counters.
  display_forced_resync_visibility: 0,
  display_forced_resync_pageshow: 0,
  display_forced_resync_online: 0,
  display_forced_resync_version_mismatch: 0,
  display_forced_resync_gap: 0,
  display_forced_resync_peer_ahead: 0,
  display_forced_resync_emergency_uncertain: 0,
  split_version_client_detected: 0,
  sw_update_conflict: 0,
  sw_forced_reload_active: 0,
  sw_forced_reload_idle: 0,
  sw_forced_reload_kiosk: 0,
  sw_forced_reload_loop_suppressed: 0,
  telemetry_payload_rejected_enum_mismatch: 0,
  telemetry_payload_rejected_shape: 0,
  telemetry_payload_rejected_rate_limit: 0,
  offline_sync_pending_reported_zero: 0,
  offline_sync_pending_reported_one: 0,
  offline_sync_pending_reported_two_to_five: 0,
  offline_sync_pending_reported_six_plus: 0,
  offline_sync_oldest_pending_none: 0,
  offline_sync_oldest_pending_lt_60s: 0,
  offline_sync_oldest_pending_lt_5m: 0,
  offline_sync_oldest_pending_lt_1h: 0,
  offline_sync_oldest_pending_gte_1h: 0,
  offline_sync_dead_letter_zero: 0,
  offline_sync_dead_letter_one: 0,
  offline_sync_dead_letter_two_plus: 0,
  offline_sync_conflict_zero: 0,
  offline_sync_conflict_one_plus: 0,
  offline_sync_session_success_zero: 0,
  offline_sync_session_success_one_to_five: 0,
  offline_sync_session_success_six_plus: 0,
  offline_sync_session_conflict_zero: 0,
  offline_sync_session_conflict_one_to_five: 0,
  offline_sync_session_conflict_six_plus: 0,
  offline_sync_session_dead_zero: 0,
  offline_sync_session_dead_one_to_five: 0,
  offline_sync_session_dead_six_plus: 0,
  offline_sync_idempotency_replay_served: 0,
  offline_sync_permanent_failure: 0,
  offline_sync_circuit_open: 0,
  replay_idempotency_collision: 0,
  job_runtime_unknown_job_name: 0,
  legacy_worker_starter_used: 0,
  job_runtime_worker_unavailable: 0,
  job_enqueue_queue_unavailable: 0,
  job_enqueue_succeeded: 0,
  rfid_batch_received: 0,
  rfid_batch_rejected_signature: 0,
  rfid_batch_rejected_schema: 0,
  rfid_batch_rejected_flag_off: 0,
  rfid_event_unknown_tag: 0,
  rfid_event_unknown_gateway: 0,
  rfid_event_stale: 0,
  rfid_event_unchanged: 0,
  rfid_event_room_changed: 0,
  semi_dock_notified: 0,
  semi_dock_skipped_deduped: 0,
  dock_return_nfc_confirmed: 0,
};

const metrics: MetricBuckets = { ...DEFAULT_COUNTERS };
const minuteWindow = new Map<string, number>();
const METRICS_STATE_FILE = path.resolve(process.cwd(), process.env.METRICS_STATE_FILE ?? ".vettrack-metrics.json");
let persistWriteScheduled = false;

function loadPersistedMetrics(): void {
  try {
    if (!fs.existsSync(METRICS_STATE_FILE)) return;
    const raw = fs.readFileSync(METRICS_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Record<MetricName, number>>;
    for (const key of Object.keys(DEFAULT_COUNTERS) as MetricName[]) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        metrics[key] = Math.floor(value);
      }
    }
  } catch (error) {
    console.warn("[metrics] failed to load persisted metrics state", error);
  }
}

function schedulePersist(): void {
  if (persistWriteScheduled) return;
  persistWriteScheduled = true;
  setTimeout(() => {
    persistWriteScheduled = false;
    try {
      fs.writeFileSync(METRICS_STATE_FILE, JSON.stringify(metrics), "utf8");
    } catch (error) {
      console.warn("[metrics] failed to persist metrics state", error);
    }
  }, 250);
}

loadPersistedMetrics();

function minuteKey(name: string): string {
  return `${name}:${Math.floor(Date.now() / 60000)}`;
}

function pruneMinuteWindow(): void {
  const minAllowedMinute = Math.floor(Date.now() / 60000) - 2;
  for (const key of minuteWindow.keys()) {
    const minuteSuffix = key.slice(key.lastIndexOf(":") + 1);
    const minute = Number.parseInt(minuteSuffix, 10);
    if (!Number.isFinite(minute) || minute < minAllowedMinute) {
      minuteWindow.delete(key);
    }
  }
}

export function incrementMetric(name: string, value: number = 1): void {
  try {
    if (!name || !Number.isFinite(value)) return;
    const amount = Math.max(0, Math.floor(value));
    if (amount === 0) return;

    if (name in metrics) {
      const typed = name as MetricName;
      metrics[typed] += amount;
      schedulePersist();
    }

    const key = minuteKey(name);
    minuteWindow.set(key, (minuteWindow.get(key) ?? 0) + amount);

    pruneMinuteWindow();
    const failuresThisMinute = minuteWindow.get(minuteKey("notifications_failed")) ?? 0;
    if (failuresThisMinute >= 25 && failuresThisMinute % 25 === 0) {
      console.warn("[metrics] notification failures spike", { failuresThisMinute });
    }
  } catch {
    // Metrics are best-effort and must never impact request or worker paths.
  }
}

function safeGetDisplayHeartbeatsAlive(): number {
  try {
    return getDisplayHeartbeatsAlive();
  } catch {
    return 0;
  }
}

const JOB_REGISTRY_RUNTIME_READINESS_FALLBACK = {
  started: false,
  workers: [] as Array<{ name: string; ok: boolean }>,
};

/** F1b/F2b — job registry counters + live pilot runtime readiness snapshot. */
export function buildJobRegistryMetrics(): MetricsSnapshot["jobRegistry"] {
  let runtimeReadiness = JOB_REGISTRY_RUNTIME_READINESS_FALLBACK;
  try {
    runtimeReadiness = getRuntimeReadiness();
  } catch {
    // Best-effort: readiness must not break metrics snapshot.
  }

  return {
    replayIdempotencyCollision: metrics.replay_idempotency_collision,
    jobRuntimeUnknownJobName: metrics.job_runtime_unknown_job_name,
    legacyWorkerStarterUsed: metrics.legacy_worker_starter_used,
    jobRuntimeWorkerUnavailable: metrics.job_runtime_worker_unavailable,
    jobEnqueueQueueUnavailable: metrics.job_enqueue_queue_unavailable,
    jobEnqueueSucceeded: metrics.job_enqueue_succeeded,
    runtimeReadiness,
  };
}

export function getMetricsSnapshot(): MetricsSnapshot {
  try {
    return {
      tasks: {
        created: metrics.tasks_created,
        started: metrics.tasks_started,
        completed: metrics.tasks_completed,
      },
      automation: {
        triggered: metrics.automation_triggered,
        executed: metrics.automation_executed,
      },
      notifications: {
        sent: metrics.notifications_sent,
        failed: metrics.notifications_failed,
      },
      queue: {
        enqueued: metrics.queue_jobs_enqueued,
        started: metrics.queue_jobs_started,
        completed: metrics.queue_jobs_completed,
        failed: metrics.queue_jobs_failed,
        deadLetter: metrics.queue_jobs_dead_letter,
      },
      reliability: {
        idempotencyHits: metrics.idempotency_hits,
        circuitBreakerOpened: metrics.circuit_breaker_opened,
        retriesAttempted: metrics.retries_attempted,
        erModeFailOpenCount: metrics.er_mode_fail_open,
      },
      realtime: {
        connections: metrics.realtime_connections,
        eventsSent: metrics.realtime_events_sent,
        duplicateDrops: metrics.realtime_duplicate_drops,
        gapResyncs: metrics.realtime_gap_resync,
        outboxFailedPublishAttempts: metrics.outbox_failed_publish_attempts,
      },
      intelligence: {
        recommendationsGenerated: metrics.recommendations_generated,
        suggestionsTriggered: metrics.suggestions_triggered,
        recommendationsShown: metrics.recommendations_shown,
        suggestionsSuppressed: metrics.suggestions_suppressed,
        scoringRuns: metrics.scoring_runs,
      },
      authority: {
        resolutionSource: {
          checkIn: metrics.authority_resolution_source_check_in,
          shift: metrics.authority_resolution_source_shift,
          noActiveShift: metrics.authority_resolution_source_no_active_shift,
        },
        denied: {
          roleNotInAllow: metrics.authority_denied_role_not_in_allow,
          legacyFallbackNotMatched: metrics.authority_denied_legacy_fallback_not_matched,
        },
        legacyFallbackUsed: metrics.authority_legacy_fallback_used,
        drift: {
          role: metrics.authority_drift_role,
          shiftLookupFailed: metrics.authority_drift_shift_lookup_failed,
        },
        resolutionFailed: metrics.authority_resolution_failed,
        oproleShadow: {
          scheduled: metrics.authority_oprole_shadow_scheduled,
          deduped: metrics.authority_oprole_shadow_deduped,
          throttled: metrics.authority_oprole_shadow_throttled,
          ran: metrics.authority_oprole_shadow_ran,
          match: metrics.authority_oprole_shadow_match,
          driftRevoked: metrics.authority_oprole_shadow_drift_revoked,
          userMissing: metrics.authority_oprole_shadow_user_missing,
          runnerFailed: metrics.authority_oprole_shadow_runner_failed,
        },
        cache: {
          disabled: metrics.authority_cache_disabled,
          checkInHit: metrics.authority_cache_checkin_hit,
          checkInMiss: metrics.authority_cache_checkin_miss,
          shiftHit: metrics.authority_cache_shift_hit,
          shiftMiss: metrics.authority_cache_shift_miss,
          inflightHit: metrics.authority_cache_inflight_hit,
          invalidateCheckIn: metrics.authority_cache_invalidate_checkin,
          invalidateShift: metrics.authority_cache_invalidate_shift,
          invalidateClinicShift: metrics.authority_cache_invalidate_clinic_shift,
          evicted: metrics.authority_cache_evicted,
          staleWriteDropped: metrics.authority_cache_stale_write_dropped,
          errorGet: metrics.authority_cache_error_get,
          errorSet: metrics.authority_cache_error_set,
          invalidateError: metrics.authority_cache_invalidate_error,
          allowlistHit: metrics.authority_cache_allowlist_hit,
          allowlistMiss: metrics.authority_cache_allowlist_miss,
          allowlistError: metrics.authority_cache_allowlist_error,
          invalidateAllowlist: metrics.authority_cache_invalidate_allowlist,
        },
        staleEnforce: {
          wouldHaveDenied: metrics.authority_stale_would_have_denied,
          denied: metrics.authority_stale_denied,
          skippedLegacyPath: metrics.authority_stale_skipped_legacy_path,
        },
        oproleEnforce: {
          denied: metrics.authority_oprole_denied,
        },
      },
      taskOwnership: {
        backfill: {
          scanned: metrics.task_ownership_backfill_scanned,
          autoResolvedById: metrics.task_ownership_backfill_auto_resolved_id,
          autoResolvedByClerkId: metrics.task_ownership_backfill_auto_resolved_clerk_id,
          queuedNoCandidate: metrics.task_ownership_backfill_queued_no_candidate,
          queuedCrossClinic: metrics.task_ownership_backfill_queued_cross_clinic,
          queuedBlocked: metrics.task_ownership_backfill_queued_blocked,
          queuedDeleted: metrics.task_ownership_backfill_queued_deleted,
          queuedAmbiguous: metrics.task_ownership_backfill_queued_ambiguous,
          skipped: metrics.task_ownership_backfill_skipped,
          error: metrics.task_ownership_backfill_error,
        },
        readPath: {
          typed: metrics.task_ownership_typed,
          stringOnly: metrics.task_ownership_string_only,
        },
      },
      staleTaskOwnership: {
        scanned: metrics.stale_task_ownership_scanned,
        wouldHaveRevoked: metrics.stale_task_ownership_would_have_revoked,
        activeTreatmentProtected: metrics.stale_task_ownership_active_treatment_protected,
        emergencySuspendSkip: metrics.stale_task_ownership_emergency_suspend_skip,
        degradedModePause: metrics.stale_task_ownership_degraded_mode_pause,
        leaseContentionRetry: metrics.stale_task_ownership_lease_contention_retry,
        revoked: metrics.stale_task_ownership_revoked,
      },
      taskAssignmentEnforce: {
        wouldHaveDenied: {
          actorRole: metrics.task_assignment_enforce_would_have_denied_actor_role,
          targetCrossClinic: metrics.task_assignment_enforce_would_have_denied_target_cross_clinic,
          targetNotActive: metrics.task_assignment_enforce_would_have_denied_target_not_active,
          targetRole: metrics.task_assignment_enforce_would_have_denied_target_role,
          exclusivity: metrics.task_assignment_enforce_would_have_denied_exclusivity,
        },
        denied: {
          actorRole: metrics.task_assignment_enforce_denied_actor_role,
          targetCrossClinic: metrics.task_assignment_enforce_denied_target_cross_clinic,
          targetNotActive: metrics.task_assignment_enforce_denied_target_not_active,
          targetRole: metrics.task_assignment_enforce_denied_target_role,
          exclusivity: metrics.task_assignment_enforce_denied_exclusivity,
        },
      },
      codeBlue: {
        initiator: {
          denied: metrics.code_blue_initiator_authority_denied,
        },
        manager: {
          allow: metrics.code_blue_manager_authority_allow,
          modeInactiveStrategyA:
            metrics.code_blue_manager_authority_mode_inactive_strategy_a,
          faultOpen: metrics.code_blue_manager_authority_fault_open,
          driftBetweenInitAndEnd:
            metrics.code_blue_manager_drift_between_init_and_end,
          shadowWouldHaveDenied: {
            oproleNotInAllowlist:
              metrics.code_blue_manager_authority_shadow_denied_oprole_not_in_allowlist,
            noOpenCheckIn:
              metrics.code_blue_manager_authority_shadow_denied_no_open_check_in,
            managerCrossClinic:
              metrics.code_blue_manager_authority_shadow_denied_manager_cross_clinic,
            userMissing:
              metrics.code_blue_manager_authority_shadow_denied_user_missing,
          },
          denied: {
            oproleNotInAllowlist:
              metrics.code_blue_manager_authority_denied_oprole_not_in_allowlist,
            noOpenCheckIn:
              metrics.code_blue_manager_authority_denied_no_open_check_in,
            managerCrossClinic:
              metrics.code_blue_manager_authority_denied_manager_cross_clinic,
            userMissing:
              metrics.code_blue_manager_authority_denied_user_missing,
          },
          midsessionShadowDenied: {
            oproleNotInAllowlist:
              metrics.code_blue_manager_midsession_shadow_denied_oprole_not_in_allowlist,
            noOpenCheckIn:
              metrics.code_blue_manager_midsession_shadow_denied_no_open_check_in,
          },
        },
        logDrugShockActor: {
          allow: metrics.code_blue_log_drug_shock_actor_authority_allow,
          modeInactiveStrategyA:
            metrics.code_blue_log_drug_shock_actor_authority_mode_inactive_strategy_a,
          shadowWouldHaveDenied: {
            oproleNotInAllowlist:
              metrics.code_blue_log_drug_shock_actor_authority_shadow_denied_oprole_not_in_allowlist,
            noOpenCheckIn:
              metrics.code_blue_log_drug_shock_actor_authority_shadow_denied_no_open_check_in,
          },
          denied: {
            oproleNotInAllowlist:
              metrics.code_blue_log_drug_shock_actor_authority_denied_oprole_not_in_allowlist,
            noOpenCheckIn:
              metrics.code_blue_log_drug_shock_actor_authority_denied_no_open_check_in,
          },
        },
      },
      clinicalInvariant: {
        resolved: {
          off: metrics.clinical_invariant_resolved_off,
          shadow: metrics.clinical_invariant_resolved_shadow,
          enforce: metrics.clinical_invariant_resolved_enforce,
        },
        shadowWouldHaveBlocked: {
          total: metrics.clinical_invariant_would_have_blocked,
          noPatientLinked: metrics.clinical_invariant_would_have_blocked_no_patient_linked,
          noActiveHospitalization:
            metrics.clinical_invariant_would_have_blocked_no_active_hospitalization,
          noActiveOrder: metrics.clinical_invariant_would_have_blocked_no_active_order,
          quantityExceedsOrder:
            metrics.clinical_invariant_would_have_blocked_quantity_exceeds_order,
        },
        blockedTotal: metrics.clinical_invariant_blocked_total,
        orphanReason: {
          noPatientLinked: metrics.clinical_invariant_orphan_reason_no_patient_linked,
          noActiveHospitalization:
            metrics.clinical_invariant_orphan_reason_no_active_hospitalization,
          noActiveOrder: metrics.clinical_invariant_orphan_reason_no_active_order,
          quantityExceedsOrder:
            metrics.clinical_invariant_orphan_reason_quantity_exceeds_order,
        },
        emergencyBypassTotal: metrics.clinical_invariant_emergency_bypass_total,
        failOpenTotal: metrics.clinical_invariant_fail_open_total,
        failClosedTotal: metrics.clinical_invariant_fail_closed_total,
        evaluatorFailureTotal: metrics.clinical_invariant_evaluator_failure_total,
      },
      display: {
        heartbeats: {
          received: {
            kiosk: metrics.display_heartbeats_received_kiosk,
            nonKiosk: metrics.display_heartbeats_received_non_kiosk,
          },
          alive: safeGetDisplayHeartbeatsAlive(),
        },
        wakeLock: {
          reacquireExhausted: metrics.display_wake_lock_reacquire_exhausted,
        },
      },
      phase9Realtime: {
        reconnectStormDetected: metrics.realtime_reconnect_storm_detected,
        emergencyDegraded: metrics.realtime_emergency_degraded,
        emergencyDegradedRecovered: metrics.realtime_emergency_degraded_recovered,
      },
      phase9CodeBlue: {
        wakeRecovery: metrics.code_blue_wake_recovery,
        snapshotFallback: metrics.code_blue_snapshot_fallback,
        propagationObserved: {
          lt_1s: metrics.code_blue_propagation_observed_lt_1s,
          lt_3s: metrics.code_blue_propagation_observed_lt_3s,
          lt_15s: metrics.code_blue_propagation_observed_lt_15s,
          gte_15s: metrics.code_blue_propagation_observed_gte_15s,
        },
      },
      phase9OfflineEmergency: {
        blocked: {
          start: metrics.offline_emergency_mutation_blocked_start,
          log: metrics.offline_emergency_mutation_blocked_log,
          end: metrics.offline_emergency_mutation_blocked_end,
          presence: metrics.offline_emergency_mutation_blocked_presence,
        },
      },
      phase9Observability: {
        displayForcedResync: {
          visibility: metrics.display_forced_resync_visibility,
          pageshow: metrics.display_forced_resync_pageshow,
          online: metrics.display_forced_resync_online,
          versionMismatch: metrics.display_forced_resync_version_mismatch,
          gap: metrics.display_forced_resync_gap,
          peerAhead: metrics.display_forced_resync_peer_ahead,
          emergencyUncertain: metrics.display_forced_resync_emergency_uncertain,
        },
        splitVersionClientDetected: metrics.split_version_client_detected,
        swUpdateConflict: metrics.sw_update_conflict,
        swForcedReload: {
          active: metrics.sw_forced_reload_active,
          idle: metrics.sw_forced_reload_idle,
          kiosk: metrics.sw_forced_reload_kiosk,
        },
        swForcedReloadLoopSuppressed: metrics.sw_forced_reload_loop_suppressed,
        telemetryPayloadRejected: {
          enumMismatch: metrics.telemetry_payload_rejected_enum_mismatch,
          shape: metrics.telemetry_payload_rejected_shape,
          rateLimit: metrics.telemetry_payload_rejected_rate_limit,
        },
      },
      offlineSync: {
        pendingReported: {
          zero: metrics.offline_sync_pending_reported_zero,
          one: metrics.offline_sync_pending_reported_one,
          twoToFive: metrics.offline_sync_pending_reported_two_to_five,
          sixPlus: metrics.offline_sync_pending_reported_six_plus,
        },
        oldestPendingAge: {
          none: metrics.offline_sync_oldest_pending_none,
          lt60s: metrics.offline_sync_oldest_pending_lt_60s,
          lt5m: metrics.offline_sync_oldest_pending_lt_5m,
          lt1h: metrics.offline_sync_oldest_pending_lt_1h,
          gte1h: metrics.offline_sync_oldest_pending_gte_1h,
        },
        deadLetter: {
          zero: metrics.offline_sync_dead_letter_zero,
          one: metrics.offline_sync_dead_letter_one,
          twoPlus: metrics.offline_sync_dead_letter_two_plus,
        },
        conflict: {
          zero: metrics.offline_sync_conflict_zero,
          onePlus: metrics.offline_sync_conflict_one_plus,
        },
        sessionSuccess: {
          zero: metrics.offline_sync_session_success_zero,
          oneToFive: metrics.offline_sync_session_success_one_to_five,
          sixPlus: metrics.offline_sync_session_success_six_plus,
        },
        sessionConflict: {
          zero: metrics.offline_sync_session_conflict_zero,
          oneToFive: metrics.offline_sync_session_conflict_one_to_five,
          sixPlus: metrics.offline_sync_session_conflict_six_plus,
        },
        sessionDead: {
          zero: metrics.offline_sync_session_dead_zero,
          oneToFive: metrics.offline_sync_session_dead_one_to_five,
          sixPlus: metrics.offline_sync_session_dead_six_plus,
        },
        idempotencyReplayServed: metrics.offline_sync_idempotency_replay_served,
        engine: {
          permanentFailure: metrics.offline_sync_permanent_failure,
          circuitOpen: metrics.offline_sync_circuit_open,
        },
      },
      jobRegistry: buildJobRegistryMetrics(),
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      tasks: { created: 0, started: 0, completed: 0 },
      automation: { triggered: 0, executed: 0 },
      notifications: { sent: 0, failed: 0 },
      queue: { enqueued: 0, started: 0, completed: 0, failed: 0, deadLetter: 0 },
      reliability: { idempotencyHits: 0, circuitBreakerOpened: 0, retriesAttempted: 0, erModeFailOpenCount: 0 },
      realtime: { connections: 0, eventsSent: 0, duplicateDrops: 0, gapResyncs: 0, outboxFailedPublishAttempts: 0 },
      intelligence: {
        recommendationsGenerated: 0,
        suggestionsTriggered: 0,
        recommendationsShown: 0,
        suggestionsSuppressed: 0,
        scoringRuns: 0,
      },
      authority: {
        resolutionSource: { checkIn: 0, shift: 0, noActiveShift: 0 },
        denied: { roleNotInAllow: 0, legacyFallbackNotMatched: 0 },
        legacyFallbackUsed: 0,
        drift: { role: 0, shiftLookupFailed: 0 },
        resolutionFailed: 0,
        oproleShadow: {
          scheduled: 0,
          deduped: 0,
          throttled: 0,
          ran: 0,
          match: 0,
          driftRevoked: 0,
          userMissing: 0,
          runnerFailed: 0,
        },
        cache: {
          disabled: 0,
          checkInHit: 0,
          checkInMiss: 0,
          shiftHit: 0,
          shiftMiss: 0,
          inflightHit: 0,
          invalidateCheckIn: 0,
          invalidateShift: 0,
          invalidateClinicShift: 0,
          evicted: 0,
          staleWriteDropped: 0,
          errorGet: 0,
          errorSet: 0,
          invalidateError: 0,
          allowlistHit: 0,
          allowlistMiss: 0,
          allowlistError: 0,
          invalidateAllowlist: 0,
        },
        staleEnforce: { wouldHaveDenied: 0, denied: 0, skippedLegacyPath: 0 },
        oproleEnforce: { denied: 0 },
      },
      taskOwnership: {
        backfill: {
          scanned: 0,
          autoResolvedById: 0,
          autoResolvedByClerkId: 0,
          queuedNoCandidate: 0,
          queuedCrossClinic: 0,
          queuedBlocked: 0,
          queuedDeleted: 0,
          queuedAmbiguous: 0,
          skipped: 0,
          error: 0,
        },
        readPath: { typed: 0, stringOnly: 0 },
      },
      staleTaskOwnership: {
        scanned: 0,
        wouldHaveRevoked: 0,
        activeTreatmentProtected: 0,
        emergencySuspendSkip: 0,
        degradedModePause: 0,
        leaseContentionRetry: 0,
        revoked: 0,
      },
      taskAssignmentEnforce: {
        wouldHaveDenied: {
          actorRole: 0,
          targetCrossClinic: 0,
          targetNotActive: 0,
          targetRole: 0,
          exclusivity: 0,
        },
        denied: {
          actorRole: 0,
          targetCrossClinic: 0,
          targetNotActive: 0,
          targetRole: 0,
          exclusivity: 0,
        },
      },
      codeBlue: {
        initiator: { denied: 0 },
        manager: {
          allow: 0,
          modeInactiveStrategyA: 0,
          faultOpen: 0,
          driftBetweenInitAndEnd: 0,
          shadowWouldHaveDenied: {
            oproleNotInAllowlist: 0,
            noOpenCheckIn: 0,
            managerCrossClinic: 0,
            userMissing: 0,
          },
          denied: {
            oproleNotInAllowlist: 0,
            noOpenCheckIn: 0,
            managerCrossClinic: 0,
            userMissing: 0,
          },
          midsessionShadowDenied: {
            oproleNotInAllowlist: 0,
            noOpenCheckIn: 0,
          },
        },
        logDrugShockActor: {
          allow: 0,
          modeInactiveStrategyA: 0,
          shadowWouldHaveDenied: {
            oproleNotInAllowlist: 0,
            noOpenCheckIn: 0,
          },
          denied: {
            oproleNotInAllowlist: 0,
            noOpenCheckIn: 0,
          },
        },
      },
      clinicalInvariant: {
        resolved: { off: 0, shadow: 0, enforce: 0 },
        shadowWouldHaveBlocked: {
          total: 0,
          noPatientLinked: 0,
          noActiveHospitalization: 0,
          noActiveOrder: 0,
          quantityExceedsOrder: 0,
        },
        blockedTotal: 0,
        orphanReason: {
          noPatientLinked: 0,
          noActiveHospitalization: 0,
          noActiveOrder: 0,
          quantityExceedsOrder: 0,
        },
        emergencyBypassTotal: 0,
        failOpenTotal: 0,
        failClosedTotal: 0,
        evaluatorFailureTotal: 0,
      },
      display: {
        heartbeats: {
          received: { kiosk: 0, nonKiosk: 0 },
          alive: 0,
        },
        wakeLock: { reacquireExhausted: 0 },
      },
      phase9Realtime: {
        reconnectStormDetected: 0,
        emergencyDegraded: 0,
        emergencyDegradedRecovered: 0,
      },
      phase9CodeBlue: {
        wakeRecovery: 0,
        snapshotFallback: 0,
        propagationObserved: { lt_1s: 0, lt_3s: 0, lt_15s: 0, gte_15s: 0 },
      },
      phase9OfflineEmergency: {
        blocked: { start: 0, log: 0, end: 0, presence: 0 },
      },
      phase9Observability: {
        displayForcedResync: {
          visibility: 0,
          pageshow: 0,
          online: 0,
          versionMismatch: 0,
          gap: 0,
          peerAhead: 0,
          emergencyUncertain: 0,
        },
        splitVersionClientDetected: 0,
        swUpdateConflict: 0,
        swForcedReload: { active: 0, idle: 0, kiosk: 0 },
        swForcedReloadLoopSuppressed: 0,
        telemetryPayloadRejected: { enumMismatch: 0, shape: 0, rateLimit: 0 },
      },
      offlineSync: {
        pendingReported: { zero: 0, one: 0, twoToFive: 0, sixPlus: 0 },
        oldestPendingAge: { none: 0, lt60s: 0, lt5m: 0, lt1h: 0, gte1h: 0 },
        deadLetter: { zero: 0, one: 0, twoPlus: 0 },
        conflict: { zero: 0, onePlus: 0 },
        sessionSuccess: { zero: 0, oneToFive: 0, sixPlus: 0 },
        sessionConflict: { zero: 0, oneToFive: 0, sixPlus: 0 },
        sessionDead: { zero: 0, oneToFive: 0, sixPlus: 0 },
        idempotencyReplayServed: 0,
        engine: { permanentFailure: 0, circuitOpen: 0 },
      },
      jobRegistry: {
        replayIdempotencyCollision: 0,
        jobRuntimeUnknownJobName: 0,
        legacyWorkerStarterUsed: 0,
        jobRuntimeWorkerUnavailable: 0,
        jobEnqueueQueueUnavailable: 0,
        jobEnqueueSucceeded: 0,
        runtimeReadiness: JOB_REGISTRY_RUNTIME_READINESS_FALLBACK,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

export function resetMetrics(): void {
  try {
    for (const key of Object.keys(DEFAULT_COUNTERS) as MetricName[]) {
      metrics[key] = 0;
    }
    minuteWindow.clear();
    schedulePersist();
  } catch {
    // Best-effort reset for tests.
  }
}
