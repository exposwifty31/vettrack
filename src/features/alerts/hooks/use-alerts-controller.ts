import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { haptics } from "@/lib/haptics";
import { computeAlerts } from "@/lib/utils";
import { countActiveAlerts } from "@/lib/alert-counts";
import { t } from "@/lib/i18n";
import type { AlertAcknowledgment } from "@/types";

// Ownership (take/release an alert) is restricted to the equipment-management
// tier — senior_technician and above. Mirrors the server gate
// `requireEffectiveRole("senior_technician")` in server/routes/alert-acks.ts.
const ALERT_OWNERSHIP_ROLES = new Set(["admin", "vet", "senior_technician"]);

export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t.alerts.timeAgo.justNow;
  if (diffMin === 1) return t.alertsPage.oneMinuteAgo;
  if (diffMin < 60) return t.alertsPage.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return t.alertsPage.oneHourAgo;
  if (diffHr < 24) return t.alertsPage.hoursAgo(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? t.alertsPage.oneDayAgo : t.alertsPage.daysAgo(diffDay);
}

/**
 * Bare duration since `date` — same bucketing as {@link formatRelativeTime} but
 * without the localized "ago" suffix, for composing with a lead-in phrase that
 * already supplies its own temporal framing (see `alertsPage.inProgressSince`
 * + `t.whatsNew` etc.). Reusing `formatRelativeTime` there doubles up the
 * temporal marker (a "since ... ago" collision — the Hebrew equivalents read
 * as redundant back-to-back temporal particles).
 */
export function formatRelativeDuration(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t.alerts.timeAgo.justNow;
  if (diffMin === 1) return t.alertsPage.oneMinuteDuration;
  if (diffMin < 60) return t.alertsPage.minutesDuration(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return t.alertsPage.oneHourDuration;
  if (diffHr < 24) return t.alertsPage.hoursDuration(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? t.alertsPage.oneDayDuration : t.alertsPage.daysDuration(diffDay);
}

/**
 * One alerts data/ack controller for every surface. The desktop page and the
 * native AlertsScreen used to duplicate this wiring (and the native screen
 * skipped it entirely — flat list, no ack, no navigation: audit H2); both now
 * consume the same queries, maps, and mutations.
 */
export function useAlertsController() {
  const queryClient = useQueryClient();
  const { userId, effectiveRole, role } = useAuth();
  const canOwnAlerts = ALERT_OWNERSHIP_ROLES.has(
    String(effectiveRole ?? role ?? "").trim().toLowerCase(),
  );

  const equipmentQ = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const acksQ = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const ackMut = useMutation({
    mutationFn: ({ equipmentId, alertType }: { equipmentId: string; alertType: string }) =>
      api.alertAcks.acknowledge(equipmentId, alertType),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/alert-acks"] });
      toast.success(t.alerts.toast.acknowledged);
    },
    onError: () => toast.error(t.alerts.toast.acknowledgeError),
  });

  const unAckMut = useMutation({
    mutationFn: ({ equipmentId, alertType }: { equipmentId: string; alertType: string }) =>
      api.alertAcks.remove(equipmentId, alertType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-acks"] });
    },
    onError: () => toast.error(t.alerts.toast.removeError),
  });

  const hasAckError = acksQ.isError;
  const alerts = equipmentQ.data ? computeAlerts(equipmentQ.data) : [];

  const acksMap = new Map<string, AlertAcknowledgment>();
  if (acksQ.data && !hasAckError) {
    for (const ack of acksQ.data) {
      acksMap.set(`${ack.equipmentId}:${ack.alertType}`, ack);
    }
  }

  const equipmentLocationMap = new Map<string, string>();
  if (equipmentQ.data) {
    for (const eq of equipmentQ.data) {
      const loc = eq.checkedOutLocation || eq.location;
      if (loc) equipmentLocationMap.set(eq.id, loc);
    }
  }

  return {
    alerts,
    acksMap,
    equipmentLocationMap,
    activeAlertCount: countActiveAlerts(alerts, acksMap),
    canOwnAlerts,
    hasAckError,
    hasFatalError: equipmentQ.isError,
    isLoading: equipmentQ.isLoading || acksQ.isLoading,
    refetch: () => Promise.all([equipmentQ.refetch(), acksQ.refetch()]),
    ack: (equipmentId: string, alertType: string) => ackMut.mutate({ equipmentId, alertType }),
    unAck: (equipmentId: string, alertType: string) => unAckMut.mutate({ equipmentId, alertType }),
  };
}
