import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { isPilotMode } from "@/lib/pilot-mode";

export const PILOT_STALE_MS_DEFAULT = 24 * 60 * 60 * 1000;

export function usePilotStaleMs(): number {
  const { userId } = useAuth();
  const { data } = useQuery({
    queryKey: ["/api/pilot/config"],
    queryFn: api.pilot.config,
    enabled: isPilotMode && !!userId,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return data?.staleMs ?? PILOT_STALE_MS_DEFAULT;
}
