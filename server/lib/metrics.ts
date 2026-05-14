import fs from "fs";
import path from "path";

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
  | "authority_cache_invalidate_error";

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
        },
      },
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
        },
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
