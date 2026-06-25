import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePaginatedEquipment } from "@/hooks/use-paginated-equipment";
import { getCurrentUserId } from "@/lib/auth-store";
import { equipmentTriageTier, TRIAGE_ORDER } from "@/lib/design-tokens";

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

  const availabilityPct =
    stats.total > 0 ? Math.round(((stats.total - stats.attention) / stats.total) * 100) : 0;

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ["/api/equipment", "paginated"] });
  }

  return { items, isLoading, isError, refetch, stats, availabilityPct };
}
