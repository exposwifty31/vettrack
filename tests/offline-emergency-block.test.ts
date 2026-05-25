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
  type EmergencyEndpointClass,
  _readEmergencyBlockBufferForTests,
  recordEmergencyBlockLocally,
} from "../src/lib/offline-emergency-block";

/** Single row in the C1 classifier snapshot tables. */
type ClassifierSnapshotCase = {
  label: string;
  url: string;
  method: string;
  expected: EmergencyEndpointClass | null;
};

/**
 * Frozen decisions for every emergency mutation shape recognized today by
 * classifyEmergencyEndpoint. Changing this table requires an intentional
 * classifier change in offline-emergency-block.ts.
 */
const EMERGENCY_MUTATION_SNAPSHOT: ClassifierSnapshotCase[] = [
  {
    label: "POST pathname /api/code-blue/sessions",
    url: "/api/code-blue/sessions",
    method: "POST",
    expected: "start",
  },
  {
    label: "POST /sessions with query string (pathname only)",
    url: "/api/code-blue/sessions?retry=1",
    method: "POST",
    expected: "start",
  },
  {
    label: "POST /sessions absolute URL",
    url: "https://vettrack.example/api/code-blue/sessions",
    method: "POST",
    expected: "start",
  },
  {
    label: "POST /sessions lowercase method",
    url: "/api/code-blue/sessions",
    method: "post",
    expected: "start",
  },
  {
    label: "POST /sessions/:id/logs",
    url: "/api/code-blue/sessions/abc-123/logs",
    method: "POST",
    expected: "log",
  },
  {
    label: "POST /sessions/:uuid/logs",
    url: "/api/code-blue/sessions/550e8400-e29b-41d4-a716-446655440000/logs",
    method: "POST",
    expected: "log",
  },
  {
    label: "POST /sessions/:id/logs with query string",
    url: "/api/code-blue/sessions/abc-123/logs?ts=1",
    method: "POST",
    expected: "log",
  },
  {
    label: "PATCH /sessions/:id/end",
    url: "/api/code-blue/sessions/abc-123/end",
    method: "PATCH",
    expected: "end",
  },
  {
    label: "PATCH /sessions/:id/end lowercase method",
    url: "/api/code-blue/sessions/abc-123/end",
    method: "patch",
    expected: "end",
  },
  {
    label: "PATCH /sessions/:id/presence",
    url: "/api/code-blue/sessions/abc-123/presence",
    method: "PATCH",
    expected: "presence",
  },
];

/**
 * Representative non-emergency paths (reads, billing, legacy events, other
 * domains). All must stay null unless the classifier is deliberately extended.
 */
const NON_EMERGENCY_SNAPSHOT: ClassifierSnapshotCase[] = [
  {
    label: "GET /sessions/active (read poll)",
    url: "/api/code-blue/sessions/active",
    method: "GET",
    expected: null,
  },
  {
    label: "GET /history (admin read)",
    url: "/api/code-blue/history",
    method: "GET",
    expected: null,
  },
  {
    label: "GET /reconciliation (admin read)",
    url: "/api/code-blue/reconciliation",
    method: "GET",
    expected: null,
  },
  {
    label: "GET /sessions/:id/dispenses",
    url: "/api/code-blue/sessions/abc-123/dispenses",
    method: "GET",
    expected: null,
  },
  {
    label: "PATCH /sessions/:id/reconcile",
    url: "/api/code-blue/sessions/abc-123/reconcile",
    method: "PATCH",
    expected: null,
  },
  {
    label: "POST /sessions/:id/manual-billing",
    url: "/api/code-blue/sessions/abc-123/manual-billing",
    method: "POST",
    expected: null,
  },
  {
    label: "POST /events (legacy start)",
    url: "/api/code-blue/events",
    method: "POST",
    expected: null,
  },
  {
    label: "PATCH /events/:id (legacy end)",
    url: "/api/code-blue/events/evt-1",
    method: "PATCH",
    expected: null,
  },
  {
    label: "GET /events (legacy list)",
    url: "/api/code-blue/events",
    method: "GET",
    expected: null,
  },
  {
    label: "POST /equipment",
    url: "/api/equipment",
    method: "POST",
    expected: null,
  },
  {
    label: "GET /display/snapshot",
    url: "/api/display/snapshot",
    method: "GET",
    expected: null,
  },
  {
    label: "POST /realtime/telemetry",
    url: "/api/realtime/telemetry",
    method: "POST",
    expected: null,
  },
  {
    label: "PATCH /sessions (wrong method for start)",
    url: "/api/code-blue/sessions",
    method: "PATCH",
    expected: null,
  },
  {
    label: "POST /sessions/:id/end (wrong method for end)",
    url: "/api/code-blue/sessions/abc-123/end",
    method: "POST",
    expected: null,
  },
  {
    label: "GET /sessions (wrong method for start)",
    url: "/api/code-blue/sessions",
    method: "GET",
    expected: null,
  },
  {
    label: "POST /sessions/:id/logs/extra segment",
    url: "/api/code-blue/sessions/abc-123/logs/extra",
    method: "POST",
    expected: null,
  },
  {
    label: "POST /sessions/active (read-shaped path, wrong method)",
    url: "/api/code-blue/sessions/active",
    method: "POST",
    expected: null,
  },
];

function decisionsForCases(cases: ClassifierSnapshotCase[]) {
  return cases.map((c) => ({
    label: c.label,
    url: c.url,
    method: c.method,
    decision: classifyEmergencyEndpoint(c.url, c.method),
  }));
}

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

describe("offline-emergency-block — classifyEmergencyEndpoint snapshot (C1)", () => {
  it.each(EMERGENCY_MUTATION_SNAPSHOT)(
    "emergency: $label → $expected",
    ({ url, method, expected }) => {
      expect(classifyEmergencyEndpoint(url, method)).toBe(expected);
    },
  );

  it.each(NON_EMERGENCY_SNAPSHOT)(
    "non-emergency: $label → null",
    ({ url, method, expected }) => {
      expect(classifyEmergencyEndpoint(url, method)).toBe(expected);
    },
  );

  it("frozen inline snapshot of all classifier decisions", () => {
    expect(decisionsForCases([...EMERGENCY_MUTATION_SNAPSHOT, ...NON_EMERGENCY_SNAPSHOT])).toMatchInlineSnapshot(`
      [
        {
          "decision": "start",
          "label": "POST pathname /api/code-blue/sessions",
          "method": "POST",
          "url": "/api/code-blue/sessions",
        },
        {
          "decision": "start",
          "label": "POST /sessions with query string (pathname only)",
          "method": "POST",
          "url": "/api/code-blue/sessions?retry=1",
        },
        {
          "decision": "start",
          "label": "POST /sessions absolute URL",
          "method": "POST",
          "url": "https://vettrack.example/api/code-blue/sessions",
        },
        {
          "decision": "start",
          "label": "POST /sessions lowercase method",
          "method": "post",
          "url": "/api/code-blue/sessions",
        },
        {
          "decision": "log",
          "label": "POST /sessions/:id/logs",
          "method": "POST",
          "url": "/api/code-blue/sessions/abc-123/logs",
        },
        {
          "decision": "log",
          "label": "POST /sessions/:uuid/logs",
          "method": "POST",
          "url": "/api/code-blue/sessions/550e8400-e29b-41d4-a716-446655440000/logs",
        },
        {
          "decision": "log",
          "label": "POST /sessions/:id/logs with query string",
          "method": "POST",
          "url": "/api/code-blue/sessions/abc-123/logs?ts=1",
        },
        {
          "decision": "end",
          "label": "PATCH /sessions/:id/end",
          "method": "PATCH",
          "url": "/api/code-blue/sessions/abc-123/end",
        },
        {
          "decision": "end",
          "label": "PATCH /sessions/:id/end lowercase method",
          "method": "patch",
          "url": "/api/code-blue/sessions/abc-123/end",
        },
        {
          "decision": "presence",
          "label": "PATCH /sessions/:id/presence",
          "method": "PATCH",
          "url": "/api/code-blue/sessions/abc-123/presence",
        },
        {
          "decision": null,
          "label": "GET /sessions/active (read poll)",
          "method": "GET",
          "url": "/api/code-blue/sessions/active",
        },
        {
          "decision": null,
          "label": "GET /history (admin read)",
          "method": "GET",
          "url": "/api/code-blue/history",
        },
        {
          "decision": null,
          "label": "GET /reconciliation (admin read)",
          "method": "GET",
          "url": "/api/code-blue/reconciliation",
        },
        {
          "decision": null,
          "label": "GET /sessions/:id/dispenses",
          "method": "GET",
          "url": "/api/code-blue/sessions/abc-123/dispenses",
        },
        {
          "decision": null,
          "label": "PATCH /sessions/:id/reconcile",
          "method": "PATCH",
          "url": "/api/code-blue/sessions/abc-123/reconcile",
        },
        {
          "decision": null,
          "label": "POST /sessions/:id/manual-billing",
          "method": "POST",
          "url": "/api/code-blue/sessions/abc-123/manual-billing",
        },
        {
          "decision": null,
          "label": "POST /events (legacy start)",
          "method": "POST",
          "url": "/api/code-blue/events",
        },
        {
          "decision": null,
          "label": "PATCH /events/:id (legacy end)",
          "method": "PATCH",
          "url": "/api/code-blue/events/evt-1",
        },
        {
          "decision": null,
          "label": "GET /events (legacy list)",
          "method": "GET",
          "url": "/api/code-blue/events",
        },
        {
          "decision": null,
          "label": "POST /equipment",
          "method": "POST",
          "url": "/api/equipment",
        },
        {
          "decision": null,
          "label": "GET /display/snapshot",
          "method": "GET",
          "url": "/api/display/snapshot",
        },
        {
          "decision": null,
          "label": "POST /realtime/telemetry",
          "method": "POST",
          "url": "/api/realtime/telemetry",
        },
        {
          "decision": null,
          "label": "PATCH /sessions (wrong method for start)",
          "method": "PATCH",
          "url": "/api/code-blue/sessions",
        },
        {
          "decision": null,
          "label": "POST /sessions/:id/end (wrong method for end)",
          "method": "POST",
          "url": "/api/code-blue/sessions/abc-123/end",
        },
        {
          "decision": null,
          "label": "GET /sessions (wrong method for start)",
          "method": "GET",
          "url": "/api/code-blue/sessions",
        },
        {
          "decision": null,
          "label": "POST /sessions/:id/logs/extra segment",
          "method": "POST",
          "url": "/api/code-blue/sessions/abc-123/logs/extra",
        },
        {
          "decision": null,
          "label": "POST /sessions/active (read-shaped path, wrong method)",
          "method": "POST",
          "url": "/api/code-blue/sessions/active",
        },
      ]
    `);
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
