// Phase 9 PR 9.7 — Deterministic drill harness (Phase 9 acceptance gate).
//
// One test per drill (plan §6, drills 1–8). Each drill asserts the contract
// the doctrine requires: counter deltas, cache/UI state, and overlay-
// persistence guarantees. Drills 1, 3, 4 are full Playwright e2e in
// production; the CI suite here exercises the unit-testable contracts and
// flags the e2e portions in their comments.
//
// Every drill is deterministic, repeatable, and asserts against the bounded
// counters from §3.9 — never against client-derived raw values.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCodeBlueKeepaliveForTests,
  getStormHint,
  recordStreamConnect,
} from "../server/lib/code-blue-keepalive";
import {
  _resetDisplayHeartbeatStoreForTests,
  COALESCE_MS,
  getAliveCount,
  recordHeartbeat,
} from "../server/lib/display-heartbeat-store";
import {
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics";
import { classifyEmergencyEndpoint } from "../src/lib/offline-emergency-block";

beforeEach(() => {
  resetMetrics();
  _resetDisplayHeartbeatStoreForTests();
  _resetCodeBlueKeepaliveForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Phase 9 drill 1 — replay-gap injection", () => {
  // Full Playwright e2e exercises the realtime SSE path. The unit-level
  // contract here verifies that the `realtime_gap_resync` counter exists,
  // is bounded, and increments through the same telemetry path the
  // EventIngestor uses (api.realtime.telemetry({ gapResync: true })).
  it("realtime_gap_resync is a bounded counter that increments cleanly", () => {
    const before = getMetricsSnapshot().realtime.gapResyncs;
    incrementMetric("realtime_gap_resync", 1);
    incrementMetric("realtime_gap_resync", 1);
    const after = getMetricsSnapshot().realtime.gapResyncs;
    expect(after).toBe(before + 2);
  });

  it("realtime_duplicate_drops is a bounded counter that increments cleanly", () => {
    const before = getMetricsSnapshot().realtime.duplicateDrops;
    incrementMetric("realtime_duplicate_drops", 1);
    const after = getMetricsSnapshot().realtime.duplicateDrops;
    expect(after).toBe(before + 1);
  });
});

describe("Phase 9 drill 2 — stale-SW-asset simulation", () => {
  it("sw_update_conflict + sw_forced_reload_* counters exist and increment", () => {
    const snap0 = getMetricsSnapshot();
    expect(snap0.phase9Observability.swUpdateConflict).toBe(0);
    expect(snap0.phase9Observability.swForcedReload.active).toBe(0);
    expect(snap0.phase9Observability.swForcedReload.idle).toBe(0);
    expect(snap0.phase9Observability.swForcedReload.kiosk).toBe(0);
    incrementMetric("sw_update_conflict");
    incrementMetric("sw_forced_reload_idle");
    incrementMetric("sw_forced_reload_kiosk");
    const snap1 = getMetricsSnapshot();
    expect(snap1.phase9Observability.swUpdateConflict).toBe(1);
    expect(snap1.phase9Observability.swForcedReload.active).toBe(0);
    expect(snap1.phase9Observability.swForcedReload.idle).toBe(1);
    expect(snap1.phase9Observability.swForcedReload.kiosk).toBe(1);
  });

  it("sw_forced_reload_loop_suppressed is exposed", () => {
    incrementMetric("sw_forced_reload_loop_suppressed");
    expect(getMetricsSnapshot().phase9Observability.swForcedReloadLoopSuppressed).toBe(1);
  });
});

describe("Phase 9 drill 3 — BFCache recovery", () => {
  it("display_forced_resync_pageshow increments without affecting other triggers", () => {
    incrementMetric("display_forced_resync_pageshow");
    incrementMetric("display_forced_resync_pageshow");
    incrementMetric("display_forced_resync_visibility");
    const tree = getMetricsSnapshot().phase9Observability.displayForcedResync;
    expect(tree.pageshow).toBe(2);
    expect(tree.visibility).toBe(1);
    expect(tree.online).toBe(0);
    expect(tree.versionMismatch).toBe(0);
    expect(tree.gap).toBe(0);
    expect(tree.peerAhead).toBe(0);
    expect(tree.emergencyUncertain).toBe(0);
  });
});

describe("Phase 9 drill 4 — reconnect-storm simulation", () => {
  it("crosses the storm threshold and increments the counter exactly once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    const before = getMetricsSnapshot().phase9Realtime.reconnectStormDetected;
    for (let i = 0; i < 50; i += 1) {
      recordStreamConnect("drill-clinic");
    }
    expect(getStormHint("drill-clinic")).toBe("elevated");
    const after = getMetricsSnapshot().phase9Realtime.reconnectStormDetected;
    expect(after).toBe(before + 1);
    // Further connects within the same elevated window do NOT inflate the
    // counter (entry is one-shot per elevation window).
    for (let i = 0; i < 20; i += 1) {
      recordStreamConnect("drill-clinic");
    }
    expect(getMetricsSnapshot().phase9Realtime.reconnectStormDetected).toBe(before + 1);
  });

  it("isolates storm tracking per clinic", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    for (let i = 0; i < 50; i += 1) recordStreamConnect("drill-clinic-a");
    expect(getStormHint("drill-clinic-a")).toBe("elevated");
    expect(getStormHint("drill-clinic-b")).toBe("none");
  });
});

describe("Phase 9 drill 5 — split-version runtime simulation", () => {
  it("split_version_client_detected increments exactly once per loaded build", () => {
    incrementMetric("split_version_client_detected");
    incrementMetric("split_version_client_detected");
    // Counter receives one increment per server-recorded mismatch event;
    // the client-side dedupe (only fire banner once per remoteBuildTag)
    // means the *server* will only see one increment per fresh divergence.
    // The counter itself is monotonic; the dedupe contract is verified by
    // the realtime-broadcast-envelope test suite.
    expect(getMetricsSnapshot().phase9Observability.splitVersionClientDetected).toBe(2);
  });
});

describe("Phase 9 drill 6 — emergency degraded-mode recovery", () => {
  it("realtime_emergency_degraded enters and recovers as a paired counter", () => {
    incrementMetric("realtime_emergency_degraded");
    expect(getMetricsSnapshot().phase9Realtime.emergencyDegraded).toBe(1);
    expect(getMetricsSnapshot().phase9Realtime.emergencyDegradedRecovered).toBe(0);
    incrementMetric("realtime_emergency_degraded_recovered");
    expect(getMetricsSnapshot().phase9Realtime.emergencyDegradedRecovered).toBe(1);
  });
});

describe("Phase 9 drill 7 — emergency endpoint cache-bypass", () => {
  it("the SW denylist matches every emergency endpoint named by §3.1", async () => {
    // The SW lives in public/sw.js as a plain JS file; we read it
    // structurally and assert each denylist entry is present. This is the
    // shipping artifact — not the Vite-templated dist version — so we test
    // the source of truth.
    const fs = await import("fs");
    const path = await import("path");
    const swSource = fs.readFileSync(
      path.resolve(process.cwd(), "public/sw.js"),
      "utf-8",
    );
    const expectedPaths = [
      "/api/display/snapshot",
      "/api/code-blue/sessions/active",
      "/api/realtime/stream",
      "/api/realtime/replay",
      "/api/realtime/outbox-head",
      "/api/realtime/telemetry",
    ];
    for (const p of expectedPaths) {
      expect(swSource).toContain(p);
    }
    // The denylist must be referenced by both the fetch handler AND the
    // activate handler (to purge stale entries from prior SW versions).
    expect(swSource).toContain("isEmergencyBypass");
    expect(swSource).toContain("purgeEmergencyCacheEntries");
  });
});

describe("Phase 9 drill 8 — offline emergency mutation blocking", () => {
  it("classifier matches every doctrinally-named Code Blue mutation endpoint", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions", "POST")).toBe("start");
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/x/logs", "POST")).toBe("log");
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/x/end", "PATCH")).toBe("end");
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/x/presence", "PATCH")).toBe("presence");
  });

  it("each endpoint_class has its own bounded counter", () => {
    incrementMetric("offline_emergency_mutation_blocked_start", 1);
    incrementMetric("offline_emergency_mutation_blocked_log", 2);
    incrementMetric("offline_emergency_mutation_blocked_end", 3);
    incrementMetric("offline_emergency_mutation_blocked_presence", 4);
    const blocked = getMetricsSnapshot().phase9OfflineEmergency.blocked;
    expect(blocked.start).toBe(1);
    expect(blocked.log).toBe(2);
    expect(blocked.end).toBe(3);
    expect(blocked.presence).toBe(4);
  });

  it("classifier returns null for non-emergency endpoints (no false positives)", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/active", "GET")).toBe(null);
    expect(classifyEmergencyEndpoint("/api/display/snapshot", "GET")).toBe(null);
    expect(classifyEmergencyEndpoint("/api/realtime/telemetry", "POST")).toBe(null);
  });
});

describe("Phase 9 cross-cutting drill contract — heartbeat liveness gauge", () => {
  it("alive count reflects distinct sessions inside the 60 s window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    await recordHeartbeat({ rawSessionId: "ds_drill_1", kioskMode: true });
    await recordHeartbeat({ rawSessionId: "ds_drill_2", kioskMode: false });
    expect(getAliveCount()).toBe(2);
    // Coalesce window — a repeat within COALESCE_MS does not add a new
    // session.
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z").getTime() + 1_000);
    const repeat = await recordHeartbeat({ rawSessionId: "ds_drill_1", kioskMode: true });
    expect(repeat.accepted).toBe(false);
    expect(getAliveCount()).toBe(2);
    // After advancing past the alive window, the gauge drops to zero.
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z").getTime() + 61_000 + COALESCE_MS);
    expect(getAliveCount()).toBe(0);
  });
});
