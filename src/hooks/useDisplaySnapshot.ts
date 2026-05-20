// src/hooks/useDisplaySnapshot.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DisplaySnapshot } from "@/types";

export function useDisplaySnapshot(): DisplaySnapshot | undefined {
  const { data } = useQuery<DisplaySnapshot>({
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
  return data;
}
