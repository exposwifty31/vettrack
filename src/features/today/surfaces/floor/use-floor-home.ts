import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getCurrentUserId } from "@/lib/auth-store";
import { useTodayShift } from "../../hooks/use-today-shift";
import { deriveHeroState } from "../OnShiftHero";

/**
 * Floor data engine. Wraps the shared {@link useTodayShift} (pulse / tasks /
 * equipment / criticality — all cache-deduped, shared across the today home surfaces) and adds
 * the "equipment checked out to me" read. `heroState` is derived here so the surface
 * stays presentational. No new endpoint — `listMy` hits the existing GET /api/equipment/my.
 */
export function useFloorHome() {
  const today = useTodayShift();
  const userId = getCurrentUserId();

  const {
    data: myEquipment,
    isLoading: myEquipmentLoading,
    isError: myEquipmentError,
    refetch: refetchMyEquipment,
  } = useQuery({
    // Canonical bare key (matches layout.tsx / my-equipment page) so the cache dedupes.
    queryKey: ["/api/equipment/my"],
    queryFn: api.equipment.listMy,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { pulse, pulseLoading } = today;
  // Match the pre-split home: the hero "loading" keys on the PULSE only, so a fast
  // pulse error while tasks/equipment are still in flight shows "noshift", not a skeleton.
  const heroState = deriveHeroState(pulse, pulseLoading);

  return {
    ...today,
    myEquipment,
    myEquipmentLoading,
    myEquipmentError,
    refetchMyEquipment,
    heroState,
    totalCount: today.equipment?.length ?? 0,
  };
}
