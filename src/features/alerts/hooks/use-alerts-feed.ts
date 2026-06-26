import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet } from "@/lib/alert-counts";
import type { Alert } from "@/types";

export function useAlertsFeed() {
  const queryClient = useQueryClient();

  const { data: equipment, isLoading: eqLoading, isError: eqError } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
  });

  const { data: acks, isLoading: acksLoading, isError: acksError } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
  });

  const ackSet = buildAlertAckSet(acks ?? []);
  const allAlerts: Alert[] = equipment ? computeAlerts(equipment) : [];
  const alerts = allAlerts.filter((a) => !ackSet.has(`${a.equipmentId}:${a.type}`));

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
    queryClient.invalidateQueries({ queryKey: ["/api/alert-acks"] });
  }

  return {
    alerts,
    isLoading: eqLoading || acksLoading,
    isError: eqError || acksError,
    refetch,
  };
}
