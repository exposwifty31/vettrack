// Phase 9 PR 9.5 — emergency endpoint classifier tests.
//
// Verifies that:
//   - Code Blue mutation endpoints are correctly classified into the bounded
//     {start, log, end, presence} enum.
//   - Non-Code-Blue endpoints are not matched.
//   - Read endpoints (GET) for Code Blue sessions are NOT classified.
//   - Both absolute URLs and pathnames are accepted.
//
// The sessionStorage buffer behavior is exercised indirectly via the
// recordEmergencyBlockLocally / _readEmergencyBlockBufferForTests pair using a
// jsdom-style sessionStorage shim.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _clearEmergencyBlockBufferForTests,
  classifyEmergencyEndpoint,
  _readEmergencyBlockBufferForTests,
  recordEmergencyBlockLocally,
} from "../src/lib/offline-emergency-block";

// Minimal sessionStorage shim — the lib uses safeStorageGetItem which reads
// window.sessionStorage. The vitest "node" environment doesn't expose a
// global window; install a tiny stub for the duration of these tests.
function installSessionStorageShim(): () => void {
  const map = new Map<string, string>();
  const stub = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  // @ts-expect-error — test-only global
  globalThis.window = { sessionStorage: stub };
  return () => {
    // @ts-expect-error — test-only global cleanup
    delete globalThis.window;
  };
}

describe("offline-emergency-block — endpoint classification", () => {
  it("classifies POST /api/code-blue/sessions as 'start'", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions", "POST")).toBe("start");
  });

  it("classifies POST /api/code-blue/sessions/:id/logs as 'log'", () => {
    expect(
      classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/logs", "POST"),
    ).toBe("log");
  });

  it("classifies PATCH /api/code-blue/sessions/:id/end as 'end'", () => {
    expect(
      classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/end", "PATCH"),
    ).toBe("end");
  });

  it("classifies PATCH /api/code-blue/sessions/:id/presence as 'presence'", () => {
    expect(
      classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/presence", "PATCH"),
    ).toBe("presence");
  });

  it("returns null for GET /api/code-blue/sessions/active (read endpoint)", () => {
    expect(
      classifyEmergencyEndpoint("/api/code-blue/sessions/active", "GET"),
    ).toBe(null);
  });

  it("returns null for non-Code-Blue endpoints", () => {
    expect(classifyEmergencyEndpoint("/api/equipment", "POST")).toBe(null);
    expect(classifyEmergencyEndpoint("/api/display/snapshot", "GET")).toBe(null);
    expect(classifyEmergencyEndpoint("/api/realtime/telemetry", "POST")).toBe(null);
  });

  it("accepts absolute URLs as well as pathnames", () => {
    expect(
      classifyEmergencyEndpoint("https://example.test/api/code-blue/sessions", "POST"),
    ).toBe("start");
  });

  it("is method-strict — wrong methods do not classify", () => {
    // PATCH on /sessions is not a defined endpoint
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions", "PATCH")).toBe(null);
    // POST on /end is not a defined endpoint
    expect(
      classifyEmergencyEndpoint("/api/code-blue/sessions/abc/end", "POST"),
    ).toBe(null);
  });
});

describe("offline-emergency-block — sessionStorage FIFO buffer", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installSessionStorageShim();
    _clearEmergencyBlockBufferForTests();
  });
  afterEach(() => {
    _clearEmergencyBlockBufferForTests();
    teardown();
  });

  it("records and reads back entries", () => {
    recordEmergencyBlockLocally("start");
    recordEmergencyBlockLocally("log");
    const buf = _readEmergencyBlockBufferForTests();
    expect(buf).toHaveLength(2);
    expect(buf[0].endpointClass).toBe("start");
    expect(buf[1].endpointClass).toBe("log");
    expect(buf.every((e) => e.reason === "offline")).toBe(true);
  });

  it("caps the buffer at 200 entries (FIFO)", () => {
    for (let i = 0; i < 250; i += 1) {
      recordEmergencyBlockLocally("presence");
    }
    const buf = _readEmergencyBlockBufferForTests();
    expect(buf).toHaveLength(200);
    // FIFO — the most recent 200 are retained.
    expect(buf[0].endpointClass).toBe("presence");
  });
});
