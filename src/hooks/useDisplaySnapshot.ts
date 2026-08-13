// src/hooks/useDisplaySnapshot.ts
import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DisplaySnapshot } from "@/types";

const displaySnapshotQueryOptions = queryOptions<DisplaySnapshot>({
  queryKey: ["/api/display/snapshot"],
  queryFn: () => api.display.snapshot(),
  // Polls faster during Code Blue, slower otherwise
  refetchInterval: (query) => {
    const snapshot = query.state.data as DisplaySnapshot | undefined;
    return snapshot?.codeBlueSession ? 2_000 : 5_000;
  },
  // Always poll even when the tab is in the background (this is a room display)
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: false,
  staleTime: 0,
  placeholderData: (previous) => previous,
  retry: 2,
});

export function useDisplaySnapshot(): DisplaySnapshot | undefined {
  const { data } = useQuery(displaySnapshotQueryOptions);
  return data;
}

// Full query result for consumers that need connection health (failureCount,
// dataUpdatedAt). Same queryKey → shared cache entry, no extra request.
export function useDisplaySnapshotQuery(): UseQueryResult<DisplaySnapshot> {
  return useQuery(displaySnapshotQueryOptions);
}
