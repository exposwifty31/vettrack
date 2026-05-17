// Phase 9 pre-merge kill pass — regression test for the
// `getActiveCbSessionId` write-after-invalidate race.
//
// Scenario:
//   T0: keepalive emitter calls getActiveCbSessionId(clinic). Cache miss
//       → starts a DB query.
//   T1: a CB session END mutation completes and calls
//       invalidateActiveCodeBlueCache(clinic).
//   T2: the DB query started at T0 returns. Without the generation
//       guard, the helper would write the (now-stale) "active" session
//       id back into the cache for the next ACTIVE_CB_CACHE_TTL_MS.
//       The next keepalive within that window would report the ended
//       session as still active.
//
// With the generation guard in place, the helper detects that
// generation has changed since T0 and refuses to repopulate the
// cache — letting the next caller hit the DB again and observe the
// post-end state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB read function used by getActiveCbSessionId. We control
// when its promise resolves so we can interleave invalidation between
// the query start and its return.
let resolveNextRead: (value: string | null) => void = () => {};

vi.mock("../server/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () =>
              new Promise<{ id: string }[]>((resolve) => {
                resolveNextRead = (value) => {
                  resolve(value === null ? [] : [{ id: value }]);
                };
              }),
          }),
        }),
      }),
    }),
  },
  codeBlueSessions: { id: "id", clinicId: "clinicId", status: "status", startedAt: "startedAt" },
}));

import {
  _resetCodeBlueKeepaliveForTests,
  invalidateActiveCodeBlueCache,
  __getActiveCbSessionIdForTests,
} from "../server/lib/code-blue-keepalive";

describe("code-blue keepalive cache — invalidation generation guard", () => {
  beforeEach(() => {
    _resetCodeBlueKeepaliveForTests();
    resolveNextRead = () => {};
  });

  afterEach(() => {
    _resetCodeBlueKeepaliveForTests();
  });

  it("refuses to repopulate the cache when invalidate fires mid-query", async () => {
    // First call enters the cache-miss branch and starts the DB query.
    const inFlight = __getActiveCbSessionIdForTests("clinic-A");

    // Simulate the END mutation invalidating the cache BEFORE the DB
    // query resolves.
    invalidateActiveCodeBlueCache("clinic-A");
    // Now resolve the DB query with the stale "active" value.
    resolveNextRead("stale-session-id");
    const result = await inFlight;
    // The helper still returns the value to the caller (the in-flight
    // emit), but it must NOT write it into the cache.
    expect(result).toBe("stale-session-id");

    // The next call MUST hit the DB again (cache must NOT have been
    // populated with the stale value). Resolve the second read with the
    // post-end "no active CB" state.
    const second = __getActiveCbSessionIdForTests("clinic-A");
    resolveNextRead(null);
    const secondResult = await second;
    expect(secondResult).toBe(null);
  });

  it("populates the cache normally when no invalidation interleaves", async () => {
    const inFlight = __getActiveCbSessionIdForTests("clinic-B");
    resolveNextRead("session-XYZ");
    const result = await inFlight;
    expect(result).toBe("session-XYZ");

    // Second call should hit the cache (no DB read needed). To detect
    // that no DB read happened, we never call resolveNextRead a second
    // time — if the helper tried to read the DB, the promise would
    // hang and the test timeout below would fire.
    const second = __getActiveCbSessionIdForTests("clinic-B");
    const secondResult = await Promise.race([
      second,
      new Promise<string | null>((_, reject) =>
        setTimeout(() => reject(new Error("unexpected cache miss")), 200),
      ),
    ]);
    expect(secondResult).toBe("session-XYZ");
  });
});
