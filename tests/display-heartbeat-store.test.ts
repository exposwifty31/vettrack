// Phase 9 PR 9.2 — Department Display heartbeat store tests.
//
// Verifies:
//   - heartbeats arriving within the 10 s coalesce window are dropped
//   - heartbeats outside the coalesce window are accepted
//   - invalid session ids are rejected
//   - alive-count gauge reflects sessions seen in the last 60 s
//   - kioskMode is plumbed through the accepted result for counter routing
//
// In-process Map fallback only; the test environment has no Redis.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COALESCE_MS,
  HEARTBEAT_TTL_MS,
  _resetDisplayHeartbeatStoreForTests,
  getAliveCount,
  recordHeartbeat,
} from "../server/lib/display-heartbeat-store";

describe("display-heartbeat-store", () => {
  beforeEach(() => {
    _resetDisplayHeartbeatStoreForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDisplayHeartbeatStoreForTests();
  });

  it("accepts the first heartbeat for a session", async () => {
    const result = await recordHeartbeat({
      rawSessionId: "ds_abc123",
      kioskMode: true,
    });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.kioskMode).toBe(true);
    }
  });

  it("rejects malformed session ids", async () => {
    const result = await recordHeartbeat({
      rawSessionId: "",
      kioskMode: false,
    });
    expect(result.accepted).toBe(false);
    expect("reason" in result && result.reason).toBe("invalid");
  });

  it("strips disallowed characters and rejects empties after sanitization", async () => {
    const result = await recordHeartbeat({
      rawSessionId: "!@#$%^&*()",
      kioskMode: false,
    });
    expect(result.accepted).toBe(false);
  });

  it("coalesces a second heartbeat within the 10 s window", async () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    const first = await recordHeartbeat({ rawSessionId: "ds_session_a", kioskMode: true });
    expect(first.accepted).toBe(true);

    vi.setSystemTime(new Date("2026-05-17T12:00:05Z")); // +5 s
    const second = await recordHeartbeat({ rawSessionId: "ds_session_a", kioskMode: true });
    expect(second.accepted).toBe(false);
    expect("reason" in second && second.reason).toBe("coalesced");
  });

  it("accepts a heartbeat after the coalesce window has passed", async () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    await recordHeartbeat({ rawSessionId: "ds_session_b", kioskMode: false });

    vi.setSystemTime(new Date("2026-05-17T12:00:00Z").getTime() + COALESCE_MS + 1);
    const next = await recordHeartbeat({ rawSessionId: "ds_session_b", kioskMode: false });
    expect(next.accepted).toBe(true);
  });

  it("counts distinct sessions seen in the alive window", async () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    await recordHeartbeat({ rawSessionId: "ds_one", kioskMode: true });
    await recordHeartbeat({ rawSessionId: "ds_two", kioskMode: false });
    expect(getAliveCount()).toBe(2);
  });

  it("drops sessions from the alive count after the 60 s window", async () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    await recordHeartbeat({ rawSessionId: "ds_short_lived", kioskMode: false });
    expect(getAliveCount()).toBe(1);

    // Advance past the alive window but stay within TTL (TTL=90s, alive=60s).
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z").getTime() + 61_000);
    expect(getAliveCount()).toBe(0);
  });

  it("forgets sessions after the TTL", async () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    await recordHeartbeat({ rawSessionId: "ds_ttl", kioskMode: false });

    // After TTL expires, a heartbeat outside the coalesce window should be a
    // fresh acceptance (not coalesced against the old timestamp).
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z").getTime() + HEARTBEAT_TTL_MS + 1);
    const next = await recordHeartbeat({ rawSessionId: "ds_ttl", kioskMode: false });
    expect(next.accepted).toBe(true);
  });

  it("tracks kiosk mode independently per session", async () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    const k = await recordHeartbeat({ rawSessionId: "ds_kiosk", kioskMode: true });
    const n = await recordHeartbeat({ rawSessionId: "ds_non_kiosk", kioskMode: false });
    expect(k.accepted && k.kioskMode).toBe(true);
    expect(n.accepted && !n.kioskMode).toBe(true);
  });

  it("rejects oversized raw session ids", async () => {
    const huge = "a".repeat(200);
    const result = await recordHeartbeat({ rawSessionId: huge, kioskMode: false });
    expect(result.accepted).toBe(false);
  });
});
