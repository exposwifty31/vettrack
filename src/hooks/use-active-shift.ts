import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getCurrentUserId } from "@/lib/auth-store";
import type { HomeDashboardPulse } from "@/types/tasks";

/**
 * Shared read of roster-derived shift status.
 *
 * On-shift is roster-derived server-side: the home dashboard's `shift` field is
 * populated only inside a scheduled `vt_shifts` window — there is no manual
 * clock-in/out. Off-shift, scanning and equipment checkout are not permitted.
 *
 * Reuses the `/api/home/dashboard` query key so it dedupes with the Today page
 * cache — no extra request when both are mounted.
 */
export function useActiveShift(): {
  hasActiveShift: boolean;
  isLoading: boolean;
  nextShift: HomeDashboardPulse["nextShift"];
} {
  const userId = getCurrentUserId();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return { hasActiveShift: !!data?.shift, isLoading, nextShift: data?.nextShift ?? null };
}
