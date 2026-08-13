/**
 * @vitest-environment happy-dom
 *
 * Task 3 (TV board phase 1) — display connection tracker.
 *
 * Escalation is counted in consecutive missed POLL CYCLES, never wall-time.
 * TanStack resets `failureCount` at the start of every fetch dispatch (the
 * "fetch" action's fetchState), so it can only count retries WITHIN one cycle
 * (max retry+1 = 3 at the snapshot query's retry:2) — it can never span
 * cycles. `errorUpdateCount` increments exactly once per failed cycle (after
 * retries exhaust) and never resets, so the tracker anchors it at the last
 * success and counts forward. Recovery to live is immediate on any success
 * (dataUpdatedAt advances → re-anchor). Behavior locked by the contract test
 * at the bottom — found by the board-states Playwright drill (Task 14), where
 * the failureCount-based derivation never left "live".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { DisplaySnapshot } from "@/types";

const mockQueryResult = vi.fn<[], Partial<UseQueryResult<DisplaySnapshot>>>();

vi.mock("@/hooks/useDisplaySnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useDisplaySnapshot")>();
  return {
    ...actual,
    useDisplaySnapshotQuery: () => mockQueryResult() as UseQueryResult<DisplaySnapshot>,
  };
});

import {
  useDisplayConnection,
  DELAYED_AFTER_MISSED_POLLS,
  STALE_AFTER_MISSED_POLLS,
  OFFLINE_AFTER_MISSED_POLLS,
} from "@/hooks/use-display-connection";

function queryState(
  over: { failureCount?: number; dataUpdatedAt?: number; errorUpdateCount?: number } = {},
) {
  return {
    failureCount: over.failureCount ?? 0,
    dataUpdatedAt: over.dataUpdatedAt ?? 0,
    errorUpdateCount: over.errorUpdateCount ?? 0,
  } as Partial<UseQueryResult<DisplaySnapshot>>;
}

afterEach(() => {
  mockQueryResult.mockReset();
});

describe("useDisplayConnection state derivation", () => {
  it("no missed cycles with a successful fetch is live", () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000 }));
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current).toEqual({ state: "live", lastSuccessAt: 1_000, missedPolls: 0 });
  });

  it("stays live below the delayed threshold, even with in-cycle retries pending", () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000 }));
    const { result, rerender } = renderHook(() => useDisplayConnection());
    mockQueryResult.mockReturnValue(
      queryState({
        dataUpdatedAt: 1_000,
        errorUpdateCount: DELAYED_AFTER_MISSED_POLLS - 1,
        failureCount: 2,
      }),
    );
    rerender();
    expect(result.current.state).toBe("live");
    expect(result.current.missedPolls).toBe(DELAYED_AFTER_MISSED_POLLS - 1);
  });

  it(`delayed at >= ${DELAYED_AFTER_MISSED_POLLS} consecutive missed cycles`, () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000 }));
    const { result, rerender } = renderHook(() => useDisplayConnection());
    mockQueryResult.mockReturnValue(
      queryState({ dataUpdatedAt: 1_000, errorUpdateCount: DELAYED_AFTER_MISSED_POLLS }),
    );
    rerender();
    expect(result.current.state).toBe("delayed");
    expect(result.current.missedPolls).toBe(DELAYED_AFTER_MISSED_POLLS);
  });

  it(`stale at >= ${STALE_AFTER_MISSED_POLLS} consecutive missed cycles (≈2 min at the 5 s cadence)`, () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000 }));
    const { result, rerender } = renderHook(() => useDisplayConnection());
    mockQueryResult.mockReturnValue(
      queryState({ dataUpdatedAt: 1_000, errorUpdateCount: STALE_AFTER_MISSED_POLLS }),
    );
    rerender();
    expect(result.current.state).toBe("stale");
  });

  it(`offline at >= ${OFFLINE_AFTER_MISSED_POLLS} consecutive missed cycles (≈5 min)`, () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000 }));
    const { result, rerender } = renderHook(() => useDisplayConnection());
    mockQueryResult.mockReturnValue(
      queryState({ dataUpdatedAt: 1_000, errorUpdateCount: OFFLINE_AFTER_MISSED_POLLS }),
    );
    rerender();
    expect(result.current.state).toBe("offline");
  });

  it("counts misses from the LAST success, not from mount: a success re-anchors the error count", () => {
    // Mount mid-life with an error history already behind us…
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000, errorUpdateCount: 40 }));
    const { result, rerender } = renderHook(() => useDisplayConnection());
    expect(result.current.state).toBe("live"); // history before mount is not a current outage
    // …a fresh success advances dataUpdatedAt → anchor moves…
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 2_000, errorUpdateCount: 40 }));
    rerender();
    expect(result.current).toEqual({ state: "live", lastSuccessAt: 2_000, missedPolls: 0 });
    // …then new failed cycles count from that anchor only.
    mockQueryResult.mockReturnValue(
      queryState({ dataUpdatedAt: 2_000, errorUpdateCount: 40 + DELAYED_AFTER_MISSED_POLLS }),
    );
    rerender();
    expect(result.current.state).toBe("delayed");
    expect(result.current.missedPolls).toBe(DELAYED_AFTER_MISSED_POLLS);
  });

  it("recovery is immediate: fresh dataUpdatedAt after an outage → live, zero missed", () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 1_000 }));
    const { result, rerender } = renderHook(() => useDisplayConnection());
    mockQueryResult.mockReturnValue(
      queryState({ dataUpdatedAt: 1_000, errorUpdateCount: OFFLINE_AFTER_MISSED_POLLS }),
    );
    rerender();
    expect(result.current.state).toBe("offline");
    mockQueryResult.mockReturnValue(
      queryState({ dataUpdatedAt: 2_000, errorUpdateCount: OFFLINE_AFTER_MISSED_POLLS }),
    );
    rerender();
    expect(result.current).toEqual({ state: "live", lastSuccessAt: 2_000, missedPolls: 0 });
  });

  it("never-succeeded query reports lastSuccessAt null, not 0", () => {
    mockQueryResult.mockReturnValue(queryState({ dataUpdatedAt: 0, errorUpdateCount: 2 }));
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current.lastSuccessAt).toBeNull();
    expect(result.current.missedPolls).toBe(2);
    expect(result.current.state).toBe("live");
  });

  it("threshold constants keep the documented wall-times at the ~8 s failed-cycle cadence", () => {
    // A failed cycle ≈ 5 s interval + 1 s + 2 s retry backoff (retry: 2).
    expect(DELAYED_AFTER_MISSED_POLLS).toBe(3); // ≈25 s
    expect(STALE_AFTER_MISSED_POLLS).toBe(15); // ≈2 min
    expect(OFFLINE_AFTER_MISSED_POLLS).toBe(37); // ≈5 min
    expect(DELAYED_AFTER_MISSED_POLLS).toBeLessThan(STALE_AFTER_MISSED_POLLS);
    expect(STALE_AFTER_MISSED_POLLS).toBeLessThan(OFFLINE_AFTER_MISSED_POLLS);
  });
});

describe("TanStack contract the derivation relies on (query-core 5.99)", () => {
  it("failureCount resets at the start of every cycle; errorUpdateCount accumulates one per failed cycle and survives success", async () => {
    let fail = true;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 5 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["failure-count-contract"],
          queryFn: () => {
            if (fail) throw new Error("poll missed");
            return "ok";
          },
        }),
      { wrapper },
    );
    // Cycle 1: initial fetch + 1 retry fail → one error cycle.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.errorUpdateCount).toBe(1);
    expect(result.current.failureCount).toBe(2);
    // Cycle 2: a NEW fetch resets failureCount (it does NOT reach 4) while
    // errorUpdateCount keeps climbing — this is why the tracker anchors on
    // errorUpdateCount, not failureCount.
    await result.current.refetch();
    await waitFor(() => expect(result.current.errorUpdateCount).toBe(2));
    expect(result.current.failureCount).toBe(2);
    // Recovery: success zeroes failureCount but errorUpdateCount survives.
    fail = false;
    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.failureCount).toBe(0);
    expect(result.current.errorUpdateCount).toBe(2);
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
    client.clear();
  });
});
