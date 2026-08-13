/**
 * @vitest-environment happy-dom
 *
 * Task 3 (TV board phase 1) — display connection tracker.
 * Derives ConnectionState from the shared snapshot query's failureCount +
 * dataUpdatedAt. Escalation is counted in consecutive missed polls (TanStack's
 * failureCount), never wall-time; recovery to live is immediate because
 * failureCount resets to 0 on any success (behavior locked by the last test).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from "@tanstack/react-query";
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

function queryState(over: { failureCount?: number; dataUpdatedAt?: number } = {}) {
  return {
    failureCount: over.failureCount ?? 0,
    dataUpdatedAt: over.dataUpdatedAt ?? 0,
  } as Partial<UseQueryResult<DisplaySnapshot>>;
}

afterEach(() => {
  mockQueryResult.mockReset();
});

describe("useDisplayConnection state derivation", () => {
  it("failureCount 0 with a successful fetch is live", () => {
    mockQueryResult.mockReturnValue(queryState({ failureCount: 0, dataUpdatedAt: 1_000 }));
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current).toEqual({ state: "live", lastSuccessAt: 1_000, missedPolls: 0 });
  });

  it("stays live below the delayed threshold", () => {
    mockQueryResult.mockReturnValue(
      queryState({ failureCount: DELAYED_AFTER_MISSED_POLLS - 1, dataUpdatedAt: 1_000 }),
    );
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current.state).toBe("live");
  });

  it("delayed at >= 4 consecutive misses", () => {
    mockQueryResult.mockReturnValue(
      queryState({ failureCount: DELAYED_AFTER_MISSED_POLLS, dataUpdatedAt: 1_000 }),
    );
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current.state).toBe("delayed");
    expect(result.current.missedPolls).toBe(DELAYED_AFTER_MISSED_POLLS);
  });

  it("stale at >= 24 consecutive misses (≈2 min at 5 s cadence)", () => {
    mockQueryResult.mockReturnValue(
      queryState({ failureCount: STALE_AFTER_MISSED_POLLS, dataUpdatedAt: 1_000 }),
    );
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current.state).toBe("stale");
  });

  it("offline at >= 60 consecutive misses", () => {
    mockQueryResult.mockReturnValue(
      queryState({ failureCount: OFFLINE_AFTER_MISSED_POLLS, dataUpdatedAt: 1_000 }),
    );
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current.state).toBe("offline");
  });

  it("recovery is immediate: failureCount back to 0 with fresh dataUpdatedAt → live", () => {
    mockQueryResult.mockReturnValue(
      queryState({ failureCount: OFFLINE_AFTER_MISSED_POLLS, dataUpdatedAt: 1_000 }),
    );
    const { result, rerender } = renderHook(() => useDisplayConnection());
    expect(result.current.state).toBe("offline");
    mockQueryResult.mockReturnValue(queryState({ failureCount: 0, dataUpdatedAt: 2_000 }));
    rerender();
    expect(result.current).toEqual({ state: "live", lastSuccessAt: 2_000, missedPolls: 0 });
  });

  it("never-succeeded query reports lastSuccessAt null, not 0", () => {
    mockQueryResult.mockReturnValue(queryState({ failureCount: 2, dataUpdatedAt: 0 }));
    const { result } = renderHook(() => useDisplayConnection());
    expect(result.current.lastSuccessAt).toBeNull();
  });

  it("threshold constants keep the spec ordering", () => {
    expect(DELAYED_AFTER_MISSED_POLLS).toBe(4);
    expect(STALE_AFTER_MISSED_POLLS).toBe(24);
    expect(OFFLINE_AFTER_MISSED_POLLS).toBe(60);
  });
});

describe("TanStack failureCount contract the derivation relies on", () => {
  it("failureCount accumulates across failed fetches and resets to 0 on success", async () => {
    let calls = 0;
    const client = new QueryClient({
      // Non-zero retryDelay so the intermediate failureCount > 0 state is observable
      defaultOptions: { queries: { retry: 3, retryDelay: 100 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["failure-count-contract"],
          queryFn: () => {
            calls += 1;
            if (calls < 3) throw new Error("poll missed");
            return "ok";
          },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.failureCount).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.failureCount).toBe(0);
    client.clear();
  });
});
