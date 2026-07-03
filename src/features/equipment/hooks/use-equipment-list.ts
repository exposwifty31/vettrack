import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePaginatedEquipment } from "@/hooks/use-paginated-equipment";
import { getCurrentUserId } from "@/lib/auth-store";
import { equipmentTriageTier, TRIAGE_ORDER } from "@/lib/design-tokens";
import { api } from "@/lib/api";
import { isInactive } from "@/lib/utils";

export function useEquipmentList({
  search,
  statusFilter,
}: {
  search: string;
  statusFilter: string;
}) {
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = usePaginatedEquipment({
    page: 1,
    pageSize: 50,
    enabled: !!userId,
    q: search,
    status: statusFilter,
  });

  // Full-list truth for the "not verified" readout — same query key AND same
  // isInactive predicate the alert bell uses (NativeHeader/computeAlerts), so
  // the equipment header can never disagree with the bell again (H1).
  const allEquipmentQ = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const items = useMemo(() => {
    const raw = data?.items ?? [];
    return [...raw].sort(
      (a, b) => TRIAGE_ORDER[equipmentTriageTier(a)] - TRIAGE_ORDER[equipmentTriageTier(b)],
    );
  }, [data]);

  const stats = useMemo(() => {
    let attention = 0;
    let inUse = 0;
    for (const eq of items) {
      const tier = equipmentTriageTier(eq);
      if (tier === "attention") attention++;
      else if (tier === "in_use") inUse++;
    }
    return { total: data?.total ?? items.length, attention, inUse };
  }, [items, data]);

  const verification = useMemo(() => {
    if (!allEquipmentQ.data) return { verified: null, notVerified: null };
    const notVerified = allEquipmentQ.data.filter(isInactive).length;
    return { verified: allEquipmentQ.data.length - notVerified, notVerified };
  }, [allEquipmentQ.data]);

  // null (never a fake 0%) while loading or when no items match (C2).
  const availabilityPct =
    stats.total > 0 ? Math.round(((stats.total - stats.attention) / stats.total) * 100) : null;

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ["/api/equipment", "paginated"] });
  }

  return {
    items,
    isLoading,
    isError,
    refetch,
    stats,
    availabilityPct,
    verifiedCount: verification.verified,
    notVerifiedCount: verification.notVerified,
  };
}
