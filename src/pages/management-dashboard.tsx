import { t } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { leaderPoll } from "@/lib/leader";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { computeDashboardData, type CriticalItem } from "@/lib/dashboard-utils";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { generateMonthlyReport } from "@/lib/generate-report";
import { isEquipmentRecoveryUiEnabled } from "@/lib/equipment-recovery-ui-flag";
import {
  buildManagementRecoveryCriticalRows,
  isManagementRecoveryCriticalRow,
  type ManagementRecoveryCriticalRow,
} from "@/lib/management-dashboard-recovery";
import {
  CheckCircle2,
  AlertTriangle,
  Users,
  MapPin,
  FileDown,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  QrCode,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { QrScanner } from "@/components/qr-scanner";
import { useAuth } from "@/hooks/use-auth";

export default function ManagementDashboardPage() {
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const { userId } = useAuth();

  const { data: equipment, isLoading, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    refetchInterval: leaderPoll(30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const dashData = equipment ? computeDashboardData(equipment) : null;
  const counts = dashData?.counts ?? { available: 0, inUse: 0, issues: 0, missing: 0 };
  const legacyCritical = dashData?.criticalItems ?? [];
  const displayCriticalItems = useMemo((): Array<
    CriticalItem | ManagementRecoveryCriticalRow
  > => {
    if (!isEquipmentRecoveryUiEnabled || !equipment) return legacyCritical;
    const issueRows = legacyCritical.filter((i) => i.status === "issue");
    const recoveryRows = buildManagementRecoveryCriticalRows(equipment);
    return [...issueRows, ...recoveryRows];
  }, [equipment, legacyCritical]);
  const userGroups = dashData?.userGroups ?? [];
  const locationGroups = dashData?.locationGroups ?? [];

  const lastUpdated = dataUpdatedAt
    ? format(new Date(dataUpdatedAt), "h:mm:ss a")
    : null;

  function toggleUser(userId: string) {
    setExpandedUsers((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function handleGenerateReport() {
    if (!equipment || isGeneratingReport) return;
    setIsGeneratingReport(true);
    try {
      await generateMonthlyReport(equipment);
      toast.success(t.managementDashboardPage.reportSuccess);
    } catch (err) {
      console.error("generateMonthlyReport failed", err);
      toast.error(t.managementDashboardPage.reportError);
    } finally {
      setIsGeneratingReport(false);
    }
  }

  return (
    <AppShell>
      <Helmet>
        <title>{t.managementDashboardPage.titleFull}</title>
        <meta name="description" content="Live management dashboard for veterinary hospital equipment. Track who has what, monitor locations, review critical alerts, and generate monthly PDF reports." />
        <link rel="canonical" href="https://vettrack.replit.app/dashboard" />
      </Helmet>
      <div className="flex flex-col gap-5 pb-24 animate-fade-in">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t.managementDashboardPage.title}</h1>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.managementDashboardPage.updated} {lastUpdated}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs bg-card border-border/60 text-muted-foreground hover:text-foreground"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              {t.managementDashboardPage.refresh}
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => void handleGenerateReport()}
              disabled={!equipment || equipment.length === 0 || isGeneratingReport}
              data-testid="btn-generate-report"
            >
              <FileDown className={cn("w-3.5 h-3.5", isGeneratingReport && "animate-pulse")} />
              {isGeneratingReport ? t.managementDashboardPage.reportGenerating : t.managementDashboardPage.reportButton}
            </Button>
          </div>
        </div>

        {isError && (
          <ErrorCard
            message={t.managementDashboardPage.loadEquipmentFailed}
            onRetry={() => refetch()}
          />
        )}

        {/* Summary Strip — glanceable in under 2 seconds */}
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-[72px] rounded-xl" />
            <Skeleton className="h-[72px] rounded-xl" />
            <Skeleton className="h-[72px] rounded-xl" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2" data-testid="summary-strip">
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] p-3 min-h-[72px]">
              <p className="text-2xl font-bold text-[var(--status-ok-fg)] leading-none">{counts.available}</p>
              <span className="text-[11px] font-semibold text-[var(--status-ok-fg)]">{t.managementDashboardPage.available}</span>
            </div>
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] p-3 min-h-[72px]">
              <p className="text-2xl font-bold text-[var(--status-stale-fg)] leading-none">{counts.inUse}</p>
              <span className="text-[11px] font-semibold text-[var(--status-stale-fg)]">{t.managementDashboardPage.inUse}</span>
            </div>
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-3 min-h-[72px]">
              <p className="text-2xl font-bold text-[var(--status-issue-fg)] leading-none">{counts.issues + counts.missing}</p>
              <span className="text-[11px] font-semibold text-[var(--status-issue-fg)]">{t.managementDashboardPage.issues}</span>
            </div>
          </div>
        )}

        {/* Critical alerts */}
        <Card className="bg-card border-border/60 shadow-sm" data-testid="section-critical-alerts">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              {t.managementDashboardPage.criticalAlerts}
              {displayCriticalItems.length > 0 && (
                <span className="ms-auto text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
                  {displayCriticalItems.length}
                </span>
              )}
            </CardTitle>
            {isEquipmentRecoveryUiEnabled && (
              <p className="text-xs text-muted-foreground px-4 -mt-1 pb-1">
                {t.managementDashboardPage.recoveryAlertsHint}
              </p>
            )}
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ) : displayCriticalItems.length === 0 ? (
              <div className="flex flex-col items-center py-5 gap-2 text-center">
                <CheckCircle2 className="w-7 h-7 text-[hsl(var(--status-ok))]" />
                <p className="text-sm font-medium text-foreground">{t.managementDashboardPage.allGood}</p>
                <p className="text-xs text-muted-foreground">{t.managementDashboardPage.allInPlace}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {displayCriticalItems.map((item) => {
                  const isRecovery = isManagementRecoveryCriticalRow(item);
                  const reasonText = isRecovery
                    ? t.managementDashboardPage[item.reasonKey]
                    : item.reason;
                  return (
                  <Link key={item.id} href={`/equipment/${item.id}`}>
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/60 bg-background hover:bg-muted/50 transition-colors cursor-pointer">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {reasonText}{item.location ? ` · ${item.location}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant={
                          isRecovery
                            ? "outline"
                            : item.status === "issue"
                              ? "issue"
                              : "maintenance"
                        }
                        className="shrink-0 text-[10px] px-2 py-0.5"
                      >
                        {isRecovery
                          ? t.managementDashboardPage[item.reasonKey]
                          : item.status === "issue"
                            ? t.managementDashboardPage.issue
                            : t.managementDashboardPage.missing}
                      </Badge>
                    </div>
                  </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Who has what */}
        <Card className="bg-card border-border/60 shadow-sm" data-testid="section-who-has-what">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              {t.managementDashboardPage.whoHasWhat}
              {userGroups.length > 0 && (
                <span className="ms-auto text-xs text-muted-foreground">
                  {t.managementDashboardPage.usersUnit(userGroups.length)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ) : userGroups.length === 0 ? (
              <div className="flex flex-col items-center py-5 gap-2 text-center">
                <Users className="w-7 h-7 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">{t.managementDashboardPage.allReturned}</p>
                <p className="text-xs text-muted-foreground">{t.managementDashboardPage.noneInUse}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {userGroups.map((group) => {
                  const isExpanded = expandedUsers.has(group.userId);
                  return (
                    <div key={group.userId} className="border border-border/60 rounded-xl overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between gap-3 p-3 hover:bg-muted/50 transition-colors text-start min-h-[44px]"
                        onClick={() => toggleUser(group.userId)}
                        data-testid={`user-group-toggle-${group.userId}`}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{group.userEmail}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.managementDashboardPage.itemsUnit(group.items.length)} {t.managementDashboardPage.checkedOut}
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="border-t border-border/60 bg-muted/20">
                          {group.items.map((eq) => (
                            <Link key={eq.id} href={`/equipment/${eq.id}`}>
                              <div className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors border-b border-border/40 last:border-0 cursor-pointer min-h-[44px]">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{getEquipmentDisplayName(eq)}</p>
                                  {eq.checkedOutLocation && (
                                    <p className="text-xs text-muted-foreground">{eq.checkedOutLocation}</p>
                                  )}
                                </div>
                                <Badge variant={statusToBadgeVariant(eq.status)} className="shrink-0 text-[10px] px-2 py-0.5">
                                  {eq.status}
                                </Badge>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Location overview */}
        <Card className="bg-card border-border/60 shadow-sm" data-testid="section-location-overview">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              {t.managementDashboardPage.locationOverview}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full rounded-xl" />
                <Skeleton className="h-8 w-full rounded-xl" />
                <Skeleton className="h-8 w-full rounded-xl" />
              </div>
            ) : locationGroups.length === 0 ? (
              <EmptyState
                icon={MapPin}
                message={t.managementDashboardPage.noLocationData}
                subMessage={t.managementDashboardPage.noLocationDataSubMessage}
                iconBg="bg-muted"
                iconColor="text-muted-foreground"
              />
            ) : (
              <div className="flex flex-col gap-3">
                {locationGroups.map((group) => {
                  const total = equipment?.length || 1;
                  const pct = Math.round((group.count / total) * 100);
                  return (
                    <div key={group.location} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{group.location}</span>
                        <span className="text-xs text-muted-foreground">{t.managementDashboardPage.itemsUnit(group.count)}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/50 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {scannerOpen && (
        <QrScanner onClose={() => setScannerOpen(false)} />
      )}
    </AppShell>
  );
}
