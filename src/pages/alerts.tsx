import { t } from "@/lib/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonAlertCard } from "@/components/ui/skeleton-cards";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countActiveAlerts } from "@/lib/alert-counts";
import {
  AlertTriangle,
  Clock,
  Activity,
  CheckCircle,
  Bell,
  Droplets,
  UserCheck,
  X,
  MapPin,
  Loader2,
} from "lucide-react";
import { TruncatedText } from "@/components/ui/truncated-text";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import type { Alert, AlertType, AlertAcknowledgment } from "@/types";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { haptics } from "@/lib/haptics";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { AlertsProView } from "@/components/alerts/AlertsProView";

function formatRelativeTime(date: Date): string {
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

const ALERT_CONFIG: Record<
  AlertType,
  { icon: React.ElementType; dotColor: string; label: string; badgeLabel: string; badgeClass: string; iconBg: string }
> = {
  issue: {
    icon: AlertTriangle,
    dotColor: "bg-red-400",
    label: t.alerts.types.issue.label,
    badgeLabel: t.alerts.types.issue.badgeLabel,
    badgeClass: "bg-red-50 text-red-600 border-red-200",
    iconBg: "bg-red-50",
  },
  overdue: {
    icon: Clock,
    dotColor: "bg-amber-400",
    label: t.alerts.types.overdue.label,
    badgeLabel: t.alerts.types.overdue.badgeLabel,
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    iconBg: "bg-amber-50",
  },
  sterilization_due: {
    icon: Droplets,
    dotColor: "bg-teal-400",
    label: t.alerts.types.sterilization_due.label,
    badgeLabel: t.alerts.types.sterilization_due.badgeLabel,
    badgeClass: "bg-teal-50 text-teal-700 border-teal-200",
    iconBg: "bg-teal-50",
  },
  inactive: {
    icon: Activity,
    dotColor: "bg-muted-foreground/45",
    label: t.alerts.types.inactive.label,
    badgeLabel: t.alerts.types.inactive.badgeLabel,
    badgeClass: "bg-muted text-muted-foreground border-border",
    iconBg: "bg-muted",
  },
};

// Ownership (take/release an alert) is restricted to the equipment-management
// tier — senior_technician and above. Mirrors the server gate
// `requireEffectiveRole("senior_technician")` in server/routes/alert-acks.ts.
const ALERT_OWNERSHIP_ROLES = new Set(["admin", "vet", "senior_technician"]);

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { userId, effectiveRole, role } = useAuth();
  const canOwnAlerts = ALERT_OWNERSHIP_ROLES.has(
    String(effectiveRole ?? role ?? "").trim().toLowerCase(),
  );

  const { data: equipment, isLoading: eqLoading, isError: eqError, refetch: refetchEq } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: acks, isLoading: acksLoading, isError: acksError, refetch: refetchAcks } = useQuery({
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

  const isLoading = eqLoading || acksLoading;
  const hasFatalError = eqError;
  const hasAckError = acksError;
  const alerts = equipment ? computeAlerts(equipment) : [];

  const acksMap = new Map<string, AlertAcknowledgment>();
  if (acks && !hasAckError) {
    for (const ack of acks) {
      acksMap.set(`${ack.equipmentId}:${ack.alertType}`, ack);
    }
  }
  const activeAlertCount = countActiveAlerts(alerts, acksMap);

  const equipmentLocationMap = new Map<string, string>();
  if (equipment) {
    for (const eq of equipment) {
      const loc = eq.checkedOutLocation || eq.location;
      if (loc) equipmentLocationMap.set(eq.id, loc);
    }
  }

  const grouped: Partial<Record<AlertType, Alert[]>> = {};
  for (const alert of alerts) {
    if (!grouped[alert.type]) grouped[alert.type] = [];
    grouped[alert.type]!.push(alert);
  }

  const priorityOrder: AlertType[] = ["issue", "overdue", "sterilization_due", "inactive"];

  const isDesktop = useIsDesktop();
  const pageContent = (
    <>
      <Helmet>
        <title>{t.alertsPage.title} — VetTrack</title>
        <meta name="description" content={t.alertsPage.metaDescription} />
        <link rel="canonical" href="https://vettrack.replit.app/alerts" />
      </Helmet>
      <div className="flex flex-col gap-5 pb-24 animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="vt-page-title flex items-center gap-2">
            <Bell className="w-5 h-5 text-muted-foreground" />
            {t.alertsPage.title}
          </h1>
          {activeAlertCount > 0 && (
            <span className="text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
              {t.alertsPage.activeCount(activeAlertCount)}
            </span>
          )}
        </div>

        {hasFatalError && (
          <ErrorCard
            message={t.alerts.errors.loadFailed}
            onRetry={() => {
              refetchEq();
              refetchAcks();
            }}
          />
        )}
        {hasAckError && !hasFatalError && (
          <ErrorCard
            message={t.alertsPage.ackLoadFailed}
            onRetry={() => {
              refetchAcks();
            }}
          />
        )}

        {isLoading ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="sr-only">{t.common.loading}</span>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              {t.common.loading}
            </p>
            {[...Array(5)].map((_, i) => (
              <SkeletonAlertCard key={i} />
            ))}
          </div>
        ) : hasFatalError ? null : alerts.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            message={t.alerts.empty.message}
            subMessage={t.alerts.empty.subMessage}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-500"
            borderColor="border-border/60"
            action={
              <Link href="/equipment">
                <Button variant="outline" size="sm">
                  {t.alertsPage.browseEquipment}
                </Button>
              </Link>
            }
          />
        ) : !isDesktop ? (
          <AlertsProView
            alerts={alerts}
            acksMap={acksMap}
            equipmentLocationMap={equipmentLocationMap}
            hasAckError={hasAckError}
            onNavigate={(id) => navigate(`/equipment/${id}`)}
            onAck={(equipmentId, alertType) => ackMut.mutate({ equipmentId, alertType })}
            onUnAck={(equipmentId, alertType) => unAckMut.mutate({ equipmentId, alertType })}
            canOwn={canOwnAlerts}
            formatRelativeTime={formatRelativeTime}
          />
        ) : (
          priorityOrder
            .filter((type) => grouped[type] && grouped[type]!.length > 0)
            .map((type) => {
              const config = ALERT_CONFIG[type];
              const Icon = config.icon;
              const items = grouped[type]!;

              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className={`w-2 h-2 rounded-full ${config.dotColor} shrink-0`} />
                    <h2 className="text-sm font-semibold text-foreground">{config.label}</h2>
                    <span className={`vt-text-2xs font-semibold px-2 py-0.5 rounded-full border ${config.badgeClass}`}>
                      {config.badgeLabel}
                    </span>
                    <span className="text-xs text-muted-foreground ms-auto">
                      {t.alerts.itemCount(items.length)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((alert) => {
                      const ackKey = `${alert.equipmentId}:${alert.type}`;
                      const ack = acksMap.get(ackKey);
                      const location = equipmentLocationMap.get(alert.equipmentId);

                      return (
                        <Card
                          key={`${alert.type}-${alert.equipmentId}`}
                          className="bg-card border-border/60 shadow-sm overflow-hidden"
                        >
                          {/* Clickable main area → navigate to equipment detail */}
                          <button
                            className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors active:bg-muted/50"
                            onClick={() => navigate(`/equipment/${alert.equipmentId}`)}
                            data-testid={`alert-navigate-${alert.equipmentId}`}
                          >
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${config.iconBg}`}>
                              <Icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <TruncatedText
                                text={alert.equipmentName}
                                className="font-semibold text-sm"
                                as="p"
                              />
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {alert.detail}
                              </p>
                              {location && (
                                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  {location}
                                </p>
                              )}
                            </div>
                            <ForwardChevron className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                          </button>

                          {/* Single action: acknowledge / handling status */}
                          <div className="px-4 pb-3">
                            {ack ? (
                              <div className="flex items-center justify-between gap-2 bg-muted/50 rounded-xl px-3 py-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <div className="min-w-0">
                                    <TruncatedText
                                      text={ack.acknowledgedByEmail.split("@")[0]}
                                      className="text-xs text-foreground font-medium"
                                    />
                                    <TruncatedText
                                      text={`${t.alertsPage.inProgressSince} ${formatRelativeTime(new Date(ack.acknowledgedAt))}`}
                                      className="text-xs text-muted-foreground"
                                    />
                                  </div>
                                </div>
                                {canOwnAlerts && (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="w-6 h-6 text-muted-foreground hover:text-red-500 shrink-0"
                                    disabled={hasAckError}
                                    onClick={() =>
                                      unAckMut.mutate({
                                        equipmentId: alert.equipmentId,
                                        alertType: alert.type,
                                      })
                                    }
                                    data-testid={`btn-unack-${alert.equipmentId}`}
                                    aria-label={t.alertsPage.removeAckAria}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            ) : canOwnAlerts ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-11 text-xs w-full border-border/60 text-muted-foreground hover:text-foreground"
                                disabled={hasAckError}
                                onClick={() =>
                                  ackMut.mutate({
                                    equipmentId: alert.equipmentId,
                                    alertType: alert.type,
                                  })
                                }
                                data-testid={`btn-ack-${alert.equipmentId}`}
                              >
                                <UserCheck className="w-3.5 h-3.5 me-1.5" />
                                {t.alertsPage.takeOwnership}
                              </Button>
                            ) : null}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })
        )}
      </div>
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
