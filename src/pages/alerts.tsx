import { t } from "@/lib/i18n";
import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { AlertsScreen, useAlertsController, formatRelativeTime } from "@/features/alerts";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonAlertCard } from "@/components/ui/skeleton-cards";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
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
import type { Alert, AlertType } from "@/types";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { AlertsProView } from "@/components/alerts/AlertsProView";

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

export default function AlertsPage() {
  const inMobileShell = useMobileShellContext();
  if (inMobileShell) return <AlertsScreen />;
  return <AlertsPageDesktop />;
}

function AlertsPageDesktop() {
  const [, navigate] = useLocation();
  const {
    alerts,
    acksMap,
    equipmentLocationMap,
    activeAlertCount,
    canOwnAlerts,
    hasAckError,
    hasFatalError,
    isLoading,
    refetch,
    // Renamed: the per-card `const ack = acksMap.get(...)` below shadows `ack`.
    ack: acknowledgeAlert,
    unAck: unacknowledgeAlert,
  } = useAlertsController();

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
      <div className="flex flex-1 flex-col gap-5 pb-24 animate-fade-in">
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
            onRetry={refetch}
          />
        )}
        {hasAckError && !hasFatalError && (
          <ErrorCard
            message={t.alertsPage.ackLoadFailed}
            onRetry={refetch}
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
          <div className="flex flex-1 flex-col justify-center py-6">
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
          </div>
        ) : !isDesktop ? (
          <div className="flex flex-1 flex-col min-h-0">
            <AlertsProView
            alerts={alerts}
            acksMap={acksMap}
            equipmentLocationMap={equipmentLocationMap}
            hasAckError={hasAckError}
            onNavigate={(id) => navigate(`/equipment/${id}`)}
            onAck={acknowledgeAlert}
            onUnAck={unacknowledgeAlert}
            canOwn={canOwnAlerts}
            formatRelativeTime={formatRelativeTime}
          />
          </div>
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
                                    onClick={() => unacknowledgeAlert(alert.equipmentId, alert.type)}
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
                                onClick={() => acknowledgeAlert(alert.equipmentId, alert.type)}
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
