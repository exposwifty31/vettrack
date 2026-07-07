import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getCurrentUserId } from "@/lib/auth-store";
import { useTodayShift } from "../../hooks/use-today-shift";
import type { HeroState } from "../OnShiftHero";

/**
 * Floor data engine. Wraps the shared {@link useTodayShift} (pulse / tasks /
 * equipment / criticality — all cache-deduped, shared with TodayScreen) and adds
 * the "equipment checked out to me" read. `heroState` is derived here so the surface
 * stays presentational. No new endpoint — `listMy` hits the existing GET /api/equipment/my.
 */
export function useFloorHome() {
  const today = useTodayShift();
  const userId = getCurrentUserId();

  const { data: myEquipment, isLoading: myEquipmentLoading } = useQuery({
    queryKey: ["/api/equipment/my", userId ?? ""],
    queryFn: api.equipment.listMy,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { pulse, isLoading } = today;
  const heroState: HeroState = pulse
    ? pulse.shift
      ? "active"
      : "noshift"
    : isLoading
      ? "loading"
      : "noshift";

  return {
    ...today,
    myEquipment,
    myEquipmentLoading,
    heroState,
    totalCount: today.equipment?.length ?? 0,
  };
}
