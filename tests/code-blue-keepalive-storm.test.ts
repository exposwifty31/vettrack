// Phase 9 PR 9.4 — reconnect-storm detection tests.
//
// Verifies:
//   - storm hint stays "none" below the threshold
//   - crossing the threshold elevates the hint
//   - elevation expires after STORM_DURATION_MS (proxied via getStormHint)
//
// Does not touch the keepalive emitter or DB cache — those need a live SSE
// connection / Drizzle harness which are out of scope for unit tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCodeBlueKeepaliveForTests,
  getStormHint,
  recordStreamConnect,
} from "../server/lib/code-blue-keepalive";

describe("code-blue keepalive — reconnect storm detection", () => {
  beforeEach(() => {
    _resetCodeBlueKeepaliveForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetCodeBlueKeepaliveForTests();
  });

  it("stays at 'none' below the storm threshold", () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    for (let i = 0; i < 10; i += 1) {
      recordStreamConnect("clinic-test");
    }
    expect(getStormHint("clinic-test")).toBe("none");
  });

  it("elevates the hint when ≥ 50 connects arrive within 5 s", () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    for (let i = 0; i < 50; i += 1) {
      recordStreamConnect("clinic-test");
    }
    expect(getStormHint("clinic-test")).toBe("elevated");
  });

  it("scopes elevation per clinic", () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    for (let i = 0; i < 50; i += 1) {
      recordStreamConnect("clinic-a");
    }
    expect(getStormHint("clinic-a")).toBe("elevated");
    expect(getStormHint("clinic-b")).toBe("none");
  });

  it("drops back to 'none' after STORM_DURATION_MS", () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    for (let i = 0; i < 50; i += 1) {
      recordStreamConnect("clinic-test");
    }
    expect(getStormHint("clinic-test")).toBe("elevated");
    // STORM_DURATION_MS = 30 s
    vi.setSystemTime(new Date("2026-05-17T12:00:31Z"));
    expect(getStormHint("clinic-test")).toBe("none");
  });

  it("expires connects older than the 5 s window", () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    for (let i = 0; i < 40; i += 1) {
      recordStreamConnect("clinic-test");
    }
    // Move past the 5 s window — the earlier connects fall off and we should
    // not be able to cross the threshold by recording fewer connects than
    // the threshold itself.
    vi.setSystemTime(new Date("2026-05-17T12:00:06Z"));
    for (let i = 0; i < 10; i += 1) {
      recordStreamConnect("clinic-test");
    }
    expect(getStormHint("clinic-test")).toBe("none");
  });
});
