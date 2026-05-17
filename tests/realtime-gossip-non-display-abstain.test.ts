// Phase 9 pre-merge kill pass — regression test for the
// `handleCodeBlueSeenGossip` non-display-page bug:
//
//   Before fix: non-display tabs (ER Command Center, appointments, etc.)
//   that instantiate EventIngestor also receive `code_blue_seen` gossip.
//   Their React Query cache never holds the display snapshot, so
//   `readLocalActiveCodeBlueSessionId` returned `null` for both "no
//   snapshot cached" and "snapshot says null". Every gossip from a
//   display tab with a non-null sessionId during an active Code Blue
//   was seen as a permanent mismatch and triggered
//   `establishBaselineAfterFullRefresh()` on every gossip message.
//
//   Fix: the reader returns a discriminated union `{known: false}` for
//   the "no cached snapshot" case so the gossip handler abstains
//   instead of refreshing.
//
// This test exercises the receiver path indirectly by:
//   - Constructing an EventIngestor with a QueryClient that has NO
//     display-snapshot cached.
//   - Calling its readLocalActiveCodeBlueSessionId via a controlled
//     reflection (the method is private; we cast through a structural
//     type so the test stays close to the production class).
//   - Asserting the discriminated union shape.
//
// We deliberately do NOT call into BroadcastChannel here; the
// receiver-path behavior (abstain vs refresh) is verified by the
// non-trivial fact that the helper now returns `{known: false}` for
// uncached snapshots. The full SSE / BC integration is exercised by
// the existing realtime suite at runtime.

import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    realtime: {
      telemetry: vi.fn().mockResolvedValue({ ok: true }),
      outboxHead: vi.fn().mockResolvedValue({ maxPublishedId: 0 }),
      replay: vi.fn().mockResolvedValue({ events: [], hasMore: false }),
    },
    display: { snapshot: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/er-api", () => ({
  ER_MODE_QUERY_KEY: ["er", "mode"],
  getErAssignees: vi.fn().mockResolvedValue({}),
  getErBoard: vi.fn().mockResolvedValue({}),
  getErEligibleHospitalizations: vi.fn().mockResolvedValue({}),
  getErMode: vi.fn().mockResolvedValue({}),
}));

import { EventIngestor } from "../src/lib/realtime";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "../src/lib/event-reducer";

// Structural type for the private method we want to exercise. Mirrors
// the return shape declared in `src/lib/realtime.ts`.
type LocalSessionResult =
  | { known: false }
  | { known: true; sessionId: string | null };

interface WithReader {
  readLocalActiveCodeBlueSessionId(): LocalSessionResult;
}

function getReader(ingestor: EventIngestor): WithReader {
  return ingestor as unknown as WithReader;
}

describe("EventIngestor.readLocalActiveCodeBlueSessionId — non-display-page abstain", () => {
  it("returns `{ known: false }` when the display snapshot has never been fetched (e.g., ER Command Center tab)", () => {
    const qc = new QueryClient();
    const ingestor = new EventIngestor(qc);
    const result = getReader(ingestor).readLocalActiveCodeBlueSessionId();
    expect(result).toEqual({ known: false });
  });

  it("returns `{ known: true, sessionId: null }` when the snapshot is fetched but server says no active CB", () => {
    const qc = new QueryClient();
    qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, { codeBlueSession: null });
    const ingestor = new EventIngestor(qc);
    const result = getReader(ingestor).readLocalActiveCodeBlueSessionId();
    expect(result).toEqual({ known: true, sessionId: null });
  });

  it("returns `{ known: true, sessionId: '<id>' }` when the snapshot has an active CB session", () => {
    const qc = new QueryClient();
    qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, {
      codeBlueSession: { id: "session-abc" },
    });
    const ingestor = new EventIngestor(qc);
    const result = getReader(ingestor).readLocalActiveCodeBlueSessionId();
    expect(result).toEqual({ known: true, sessionId: "session-abc" });
  });

  it("treats an empty-string session id as null (defensive — should never happen but guarded by the reader)", () => {
    const qc = new QueryClient();
    qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, {
      codeBlueSession: { id: "" },
    });
    const ingestor = new EventIngestor(qc);
    const result = getReader(ingestor).readLocalActiveCodeBlueSessionId();
    expect(result).toEqual({ known: true, sessionId: null });
  });

  it("treats non-string session id types as null", () => {
    const qc = new QueryClient();
    qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, {
      codeBlueSession: { id: 12345 },
    });
    const ingestor = new EventIngestor(qc);
    const result = getReader(ingestor).readLocalActiveCodeBlueSessionId();
    expect(result).toEqual({ known: true, sessionId: null });
  });
});
