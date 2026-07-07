import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getCurrentUserId } from "@/lib/auth-store";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countCriticalAlerts } from "@/lib/alert-counts";

export function useTodayShift() {
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();

  const { data: pulse, isLoading: pulseLoading, isError: pulseError } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 120_000,
  });

  const { data: taskDashboard, isLoading: tasksLoading, isError: tasksError } = useQuery({
    queryKey: ["/api/tasks/dashboard", userId ?? ""],
    queryFn: () => api.tasks.dashboard(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: equipment, isLoading: equipmentLoading, isError: equipmentError } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: alertAcks } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isLoading = pulseLoading || tasksLoading || equipmentLoading;
  const isError = pulseError || tasksError || equipmentError;

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertAckSet = buildAlertAckSet(alertAcks);
  const criticalCount = countCriticalAlerts(alerts, alertAckSet);
  const overdueCount = taskDashboard?.counts.overdue ?? 0;
  const itemsOutCount = equipment?.filter((e) => e.custodyState === "checked_out").length ?? 0;

  function refetch(): Promise<void> {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/home/dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard", userId ?? ""] }),
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/alert-acks"] }),
    ]).then(() => undefined);
  }

  return {
    pulse,
    taskDashboard,
    equipment,
    isLoading,
    isError,
    // Per-query flags so callers can reproduce the pre-split home gating exactly:
    // the shift hero's "loading" state keys on the pulse only, and the full-content
    // ErrorCard keys on the equipment query only (not a sibling's failure).
    pulseLoading,
    equipmentError,
    criticalCount,
    overdueCount,
    itemsOutCount,
    scansToday: pulse?.scansToday ?? 0,
    shift: pulse?.shift ?? null,
    refetch,
  };
}
