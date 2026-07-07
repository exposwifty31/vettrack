import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getCurrentUserId } from "@/lib/auth-store";
import { equipmentTriageTier } from "@/lib/design-tokens";
import { useAlertsController } from "@/features/alerts";
import { useTodayShift } from "../../hooks/use-today-shift";
import { ALERT_ORDER, roomPct } from "./ops-tile-helpers";
import type { HeroState } from "../OnShiftHero";
import type { Room } from "@/types";

/**
 * Ops data engine. Composes the shared, cache-deduped reads (useTodayShift →
 * pulse/equipment/criticality; useAlertsController → alert feed; /api/rooms) and
 * derives the coverage / exceptions / readiness figures the ops tiles render —
 * the three memos currently trapped inline in HomeTabletDashboard, reimplemented
 * here (in-fence). No new endpoint; every key is already in the query cache.
 */
export function useOpsHome() {
  const today = useTodayShift();
  const userId = getCurrentUserId();
  const alertsCtl = useAlertsController();

  const { data: rooms, isLoading: roomsLoading } = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: api.rooms.list,
    staleTime: 30_000,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: () => api.activity.feed(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const equipment = today.equipment;

  const coverage = useMemo(() => {
    if (!equipment) return { availabilityPct: null as number | null, ready: 0, notReady: 0, inUse: 0 };
    let attention = 0;
    let inUse = 0;
    for (const eq of equipment) {
      if (equipmentTriageTier(eq) === "attention") attention++;
      if (eq.usageState === "in_use") inUse++;
    }
    const total = equipment.length;
    return {
      availabilityPct: total > 0 ? Math.round(((total - attention) / total) * 100) : null,
      ready: total - attention,
      notReady: attention,
      inUse,
    };
  }, [equipment]);

  const topExceptions = useMemo(() => {
    const active = alertsCtl.alerts.filter(
      (a) => !alertsCtl.acksMap.has(`${a.equipmentId}:${a.type}`),
    );
    return [...active]
      .sort((a, b) => ALERT_ORDER.indexOf(a.type) - ALERT_ORDER.indexOf(b.type))
      .slice(0, 5);
  }, [alertsCtl.alerts, alertsCtl.acksMap]);

  const worstRooms = useMemo(() => {
    if (!rooms) return [] as { room: Room; pct: number }[];
    return rooms
      .map((room) => ({ room, pct: roomPct(room) }))
      .filter((r): r is { room: Room; pct: number } => r.pct !== null)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
  }, [rooms]);

  const heroState: HeroState = today.pulse
    ? today.pulse.shift
      ? "active"
      : "noshift"
    : today.isLoading
      ? "loading"
      : "noshift";

  return {
    ...coverage,
    itemsOut: today.itemsOutCount,
    worstRooms,
    topExceptions,
    activeAlertCount: alertsCtl.activeAlertCount,
    criticalCount: today.criticalCount,
    overdueCount: today.overdueCount,
    pulse: today.pulse,
    scansToday: today.scansToday,
    heroState,
    totalCount: equipment?.length ?? 0,
    isLoading: today.isLoading,
    isError: today.isError,
    equipment,
    refetch: today.refetch,
    roomsLoading,
    alertsLoading: alertsCtl.isLoading,
    recentItems: (activityData?.items ?? []).slice(0, 4),
    activityLoading,
  };
}
