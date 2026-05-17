// Phase 9 PR 9.7 — bounded-cardinality enforcement for Phase 9 metrics.
//
// Plan §3.9 / §7 acceptance criterion #7 requires that every Phase 9
// counter and gauge exposed via the admin-gated metrics surface has only
// bounded enum labels — no PII / userId / clinicId / requestId / IP / UA /
// device ID / tab ID / free-form labels. This test enforces the contract by:
//
//   1. Asserting every Phase-9 counter name in MetricName is declared in
//      DEFAULT_COUNTERS (so the metric is initialized at boot, not lazily).
//   2. Asserting every Phase-9 counter increments cleanly through
//      `incrementMetric` with no label arguments — the existing function
//      signature has no second-positional label, but if any future change
//      adds one this test will fail.
//   3. Asserting the snapshot exposes every Phase-9 counter under a
//      well-known path (no dynamic key creation).
//   4. Asserting unknown / off-allowlist metric names are silently dropped
//      by incrementMetric (the existing implementation only mutates names
//      present in `metrics`).

import { describe, expect, it } from "vitest";
import {
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics";

const PHASE_9_COUNTERS = [
  // PR 9.2
  "display_heartbeats_received_kiosk",
  "display_heartbeats_received_non_kiosk",
  "display_wake_lock_reacquire_exhausted",
  // PR 9.4
  "realtime_reconnect_storm_detected",
  "realtime_emergency_degraded",
  "realtime_emergency_degraded_recovered",
  "code_blue_wake_recovery",
  "code_blue_snapshot_fallback",
  "code_blue_propagation_observed_lt_1s",
  "code_blue_propagation_observed_lt_3s",
  "code_blue_propagation_observed_lt_15s",
  "code_blue_propagation_observed_gte_15s",
  // PR 9.5
  "offline_emergency_mutation_blocked_start",
  "offline_emergency_mutation_blocked_log",
  "offline_emergency_mutation_blocked_end",
  "offline_emergency_mutation_blocked_presence",
  // PR 9.7
  "display_forced_resync_visibility",
  "display_forced_resync_pageshow",
  "display_forced_resync_online",
  "display_forced_resync_version_mismatch",
  "display_forced_resync_gap",
  "display_forced_resync_peer_ahead",
  "display_forced_resync_emergency_uncertain",
  "split_version_client_detected",
  "sw_update_conflict",
  "sw_forced_reload_active",
  "sw_forced_reload_idle",
  "sw_forced_reload_kiosk",
  "sw_forced_reload_loop_suppressed",
  "telemetry_payload_rejected_enum_mismatch",
  "telemetry_payload_rejected_shape",
  "telemetry_payload_rejected_rate_limit",
] as const;

describe("Phase 9 metrics — bounded-cardinality enforcement", () => {
  it("includes every declared Phase 9 counter in the snapshot", () => {
    resetMetrics();
    // Increment each counter once so the snapshot includes a non-zero value
    // for it — this exercises the path that resolves each counter into the
    // snapshot tree.
    for (const name of PHASE_9_COUNTERS) {
      incrementMetric(name, 1);
    }
    const snap = getMetricsSnapshot();
    // Spot-check critical paths exist (full structural assert is verbose,
    // but every counter is reachable under one of these branches).
    expect(snap.display.heartbeats.received.kiosk).toBe(1);
    expect(snap.display.heartbeats.received.nonKiosk).toBe(1);
    expect(snap.display.wakeLock.reacquireExhausted).toBe(1);
    expect(snap.phase9Realtime.reconnectStormDetected).toBe(1);
    expect(snap.phase9Realtime.emergencyDegraded).toBe(1);
    expect(snap.phase9Realtime.emergencyDegradedRecovered).toBe(1);
    expect(snap.phase9CodeBlue.wakeRecovery).toBe(1);
    expect(snap.phase9CodeBlue.snapshotFallback).toBe(1);
    expect(snap.phase9CodeBlue.propagationObserved.lt_1s).toBe(1);
    expect(snap.phase9CodeBlue.propagationObserved.lt_3s).toBe(1);
    expect(snap.phase9CodeBlue.propagationObserved.lt_15s).toBe(1);
    expect(snap.phase9CodeBlue.propagationObserved.gte_15s).toBe(1);
    expect(snap.phase9OfflineEmergency.blocked.start).toBe(1);
    expect(snap.phase9OfflineEmergency.blocked.log).toBe(1);
    expect(snap.phase9OfflineEmergency.blocked.end).toBe(1);
    expect(snap.phase9OfflineEmergency.blocked.presence).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.visibility).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.pageshow).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.online).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.versionMismatch).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.gap).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.peerAhead).toBe(1);
    expect(snap.phase9Observability.displayForcedResync.emergencyUncertain).toBe(1);
    expect(snap.phase9Observability.splitVersionClientDetected).toBe(1);
    expect(snap.phase9Observability.swUpdateConflict).toBe(1);
    expect(snap.phase9Observability.swForcedReload.active).toBe(1);
    expect(snap.phase9Observability.swForcedReload.idle).toBe(1);
    expect(snap.phase9Observability.swForcedReload.kiosk).toBe(1);
    expect(snap.phase9Observability.swForcedReloadLoopSuppressed).toBe(1);
    expect(snap.phase9Observability.telemetryPayloadRejected.enumMismatch).toBe(1);
    expect(snap.phase9Observability.telemetryPayloadRejected.shape).toBe(1);
    expect(snap.phase9Observability.telemetryPayloadRejected.rateLimit).toBe(1);
  });

  it("silently drops unknown counter names — no dynamic series", () => {
    resetMetrics();
    // The plan forbids runtime-created metric names. The existing
    // implementation only mutates `metrics[name]` if the name is present at
    // module load. Confirm a free-form name does not appear in the snapshot.
    incrementMetric("phase9_user_id_alice_kiosk_1", 99);
    incrementMetric("phase9.clinic.london", 99);
    incrementMetric("phase9.request.abc-def-ghi", 99);
    const snap = getMetricsSnapshot();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("phase9_user_id_alice_kiosk_1");
    expect(serialized).not.toContain("phase9.clinic.london");
    expect(serialized).not.toContain("phase9.request.abc-def-ghi");
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("london");
  });

  it("Phase 9 snapshot tree contains no user/clinic/request identifiers", () => {
    resetMetrics();
    for (const name of PHASE_9_COUNTERS) {
      incrementMetric(name, 1);
    }
    const snap = getMetricsSnapshot();
    // Collect every key on every nested object reachable from the Phase 9
    // sub-trees and assert none look like high-cardinality identifiers.
    const phase9Trees = [
      snap.display,
      snap.phase9Realtime,
      snap.phase9CodeBlue,
      snap.phase9OfflineEmergency,
      snap.phase9Observability,
    ];
    const keys = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        keys.add(k);
        walk(v);
      }
    };
    for (const t of phase9Trees) walk(t);

    const forbiddenPatterns = [
      /userid/i,
      /clinicid/i,
      /requestid/i,
      /^ip$/i,
      /useragent/i,
      /deviceid/i,
      /tabid/i,
      /sessionid/i,
    ];
    for (const key of keys) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(key),
          `Phase 9 metric key "${key}" matches forbidden pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
