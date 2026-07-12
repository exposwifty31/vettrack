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
  /** The shift query itself failed. Distinct from off-shift: consumers must not
   *  infer "off-shift" from a missing `shift` when the read errored — defer the
   *  gate to the server (which enforces the authoritative roster) instead. */
  isError: boolean;
  nextShift: HomeDashboardPulse["nextShift"];
} {
  const userId = getCurrentUserId();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return { hasActiveShift: !!data?.shift, isLoading, isError, nextShift: data?.nextShift ?? null };
}
