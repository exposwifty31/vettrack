import { t } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ShiftSummarySheet } from "@/components/shift-summary-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { STATUS_LABELS } from "@/types";
import { formatRelativeTime } from "@/lib/utils";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import {
  PackageOpen,
  MapPin,
  LogOut,
  ChevronRight,
  Loader2,
  CheckCircle2,
  ClipboardCheck,
  QrCode,
} from "lucide-react";
import { toast } from "sonner";
import { QrScanner } from "@/components/qr-scanner";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { useAuth } from "@/hooks/use-auth";
import { haptics } from "@/lib/haptics";
import { isEquipmentRecoveryUiEnabled } from "@/lib/equipment-recovery-ui-flag";
import {
  compareRecoveryAttention,
  deriveEquipmentRecoverySnapshotFromSource,
} from "@/lib/equipment-recovery-adapter";
import { derivePersonalEquipmentDebt } from "@/lib/equipment-personal-debt";
import {
  formatPersonalDebtBreakdown,
  resolvePersonalDebtBannerKey,
} from "./my-equipment-personal-debt-labels";
import { resolveMyEquipmentRecoveryBadgeKey } from "./my-equipment-recovery-labels";

const MY_EQUIPMENT_SIDEBAR: SidebarItem[] = [
  { href: "/my-equipment", icon: PackageOpen, label: "My equipment" },
];

export default function MyEquipmentPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [returningAll, setReturningAll] = useState(false);
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [pendingReturnEquipmentId, setPendingReturnEquipmentId] = useState<string | null>(null);

  const { data: items, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/equipment/my"],
    queryFn: api.equipment.listMy,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const displayItems = useMemo(() => {
    if (!items) return items;
    if (!isEquipmentRecoveryUiEnabled) return items;
    return [...items].sort((a, b) =>
      compareRecoveryAttention(
        deriveEquipmentRecoverySnapshotFromSource(a),
        deriveEquipmentRecoverySnapshotFromSource(b),
      ),
    );
  }, [items]);

  const personalDebt = useMemo(() => {
    if (!isEquipmentRecoveryUiEnabled || !items?.length) return null;
    return derivePersonalEquipmentDebt(items);
  }, [items]);

  const listItems = isEquipmentRecoveryUiEnabled ? displayItems : items;

  const returnMut = useMutation({
    mutationFn: ({ id, isPluggedIn, plugInDeadlineMinutes }: { id: string; isPluggedIn: boolean; plugInDeadlineMinutes?: number }) =>
      api.equipment.return(id, { isPluggedIn, plugInDeadlineMinutes }),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(t.myEquipment.toast.returnSuccess);
    },
    onError: () => toast.error(t.myEquipment.toast.returnError),
  });

  async function handleReturnAll() {
    if (!items || items.length === 0) return;
    setReturningAll(true);
    try {
      await Promise.all(items.map((item) => api.equipment.return(item.id, { isPluggedIn: false })));
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(`Returned ${items.length} item${items.length !== 1 ? "s" : ""} — all equipment now available`);
    } catch {
      toast.error(t.myEquipment.toast.returnAllPartialError);
    } finally {
      setReturningAll(false);
    }
  }

  const pageBody = (
    <>
      <Helmet>
        <title>{t.equipment.myEquipment} — VetTrack</title>
        <meta name="description" content="View all equipment currently checked out to you. Return individual items or use Return All for quick end-of-shift handoffs." />
        <link rel="canonical" href="https://vettrack.replit.app/my-equipment" />
      </Helmet>
      <div className="flex flex-col gap-5 pb-24 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight">{ t.equipment.myEquipment }</h1>
            {items && items.length > 0 && (
              <p className="text-sm text-muted-foreground mt-0.5">{items.length} checked out</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-11 bg-card border-border/60 text-muted-foreground hover:text-foreground"
              onClick={() => setIsScannerOpen(true)}
              data-testid="btn-scan-qr-my-eq"
            >
              <QrCode className="w-3.5 h-3.5" />
              {t.myEquipmentPage.scanQr}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-11 bg-card border-border/60 text-muted-foreground hover:text-foreground"
              onClick={() => setShiftSummaryOpen(true)}
              data-testid="btn-shift-summary-my-eq"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              {t.myEquipmentPage.shiftSummary}
            </Button>
          </div>
        </div>

        {isError && (
          <ErrorCard
            message={t.myEquipment.errors.loadFailed}
            onRetry={() => refetch()}
          />
        )}

        {items && items.length >= 2 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full h-12 rounded-2xl border-border/60 bg-card text-foreground"
                disabled={returningAll}
                data-testid="btn-return-all"
              >
                {returningAll ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                Return All ({items.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Return all {items.length} items?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will return all {items.length} checked-out items and make them available for others.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={handleReturnAll}>
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-2xl" />
            ))}
          </div>
        ) : isError ? null : !items || items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            message={t.myEquipment.empty.message}
            subMessage={t.myEquipment.empty.subMessage}
            iconBg="bg-muted"
            iconColor="text-muted-foreground"
            borderColor="border-border/60"
            action={
              <Link href="/equipment">
                <Button variant="outline" size="sm" className="h-11 text-xs">
                  {t.myEquipmentPage.browseEquipment}
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {isEquipmentRecoveryUiEnabled &&
              personalDebt &&
              personalDebt.attentionCount > 0 &&
              (() => {
                const bannerKey = resolvePersonalDebtBannerKey(personalDebt);
                if (!bannerKey) return null;
                const bannerText = t.myEquipmentPage[bannerKey].replace(
                  "{count}",
                  String(personalDebt.attentionCount),
                );
                const breakdownText = formatPersonalDebtBreakdown(personalDebt, {
                  personalDebtBreakdownCheckedOutLong:
                    t.myEquipmentPage.personalDebtBreakdownCheckedOutLong,
                  personalDebtBreakdownVeryStale:
                    t.myEquipmentPage.personalDebtBreakdownVeryStale,
                  personalDebtBreakdownStale:
                    t.myEquipmentPage.personalDebtBreakdownStale,
                });
                return (
                  <div className="text-sm text-muted-foreground">
                    <p>{bannerText}</p>
                    {breakdownText && (
                      <p className="text-xs mt-0.5">{breakdownText}</p>
                    )}
                  </div>
                );
              })()}
            {(listItems ?? []).map((item) => {
              const recoveryBadgeKey = isEquipmentRecoveryUiEnabled
                ? resolveMyEquipmentRecoveryBadgeKey(
                    deriveEquipmentRecoverySnapshotFromSource(item),
                  )
                : null;
              return (
              <Card key={item.id} className="bg-card border-border/60 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <p className="font-semibold text-sm truncate">{item.name}</p>
                        <Badge variant={statusToBadgeVariant(item.status)} className="shrink-0 text-[10px] px-2 py-0.5">
                          {STATUS_LABELS[item.status] || item.status}
                        </Badge>
                        {recoveryBadgeKey && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] px-2 py-0.5"
                          >
                            {t.myEquipmentPage[recoveryBadgeKey]}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Since {formatRelativeTime(item.checkedOutAt)}</span>
                        {(item.checkedOutLocation || item.location) && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {item.checkedOutLocation || item.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-border/60 text-muted-foreground hover:text-foreground min-h-[44px] px-3"
                        onClick={() => setPendingReturnEquipmentId(item.id)}
                        disabled={returnMut.isPending}
                        data-testid={`btn-return-${item.id}`}
                      >
                        {returnMut.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <LogOut className="w-3.5 h-3.5 mr-1" />
                            Return
                          </>
                        )}
                      </Button>
                      <Link href={`/equipment/${item.id}`}>
                        <Button variant="ghost" size="icon-sm" className="min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground hover:bg-muted">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
            })}
          </div>
        )}
      </div>

      <ShiftSummarySheet
        open={shiftSummaryOpen}
        onClose={() => setShiftSummaryOpen(false)}
      />

      {isScannerOpen && (
        <QrScanner onClose={() => setIsScannerOpen(false)} />
      )}
      <ReturnPlugDialog
        open={Boolean(pendingReturnEquipmentId)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingReturnEquipmentId(null);
          }
        }}
        defaultDeadlineMinutes={30}
        onConfirm={({ isPluggedIn, plugInDeadlineMinutes }) => {
          if (!pendingReturnEquipmentId) return;
          returnMut.mutate(
            {
              id: pendingReturnEquipmentId,
              isPluggedIn,
              plugInDeadlineMinutes,
            },
            {
              onSettled: () => {
                setPendingReturnEquipmentId(null);
              },
            },
          );
        }}
      />
    </>
  );

  return <AppShell sidebarItems={MY_EQUIPMENT_SIDEBAR}>{pageBody}</AppShell>;
}
