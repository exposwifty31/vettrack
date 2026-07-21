import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Flag } from "lucide-react";
import { toast } from "sonner";
import { useEquipmentDetail } from "./hooks/use-equipment-detail";
import { EquipmentLocationCard } from "./EquipmentLocationCard";
import { EquipmentMetaStrip } from "./EquipmentMetaStrip";
import { EquipmentGlanceGrid } from "./EquipmentGlanceGrid";
import { EquipmentServiceCard } from "./EquipmentServiceCard";
import { EquipmentActions } from "./EquipmentActions";
import { EquipmentAccountabilityTimeline } from "./EquipmentAccountabilityTimeline";
import { ReportEquipmentIssueSheet } from "./ReportEquipmentIssueSheet";
import { ReservationBanner } from "@/components/equipment/ReservationBanner";
import { LoadingSection } from "@/components/ui/loading-section";
import { ErrorCard } from "@/components/ui/error-card";
import { Button } from "@/components/ui/button";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { shouldShowReservationBanner } from "@/lib/equipment-waitlist-ui";
import { useDirection } from "@/hooks/useDirection";
import { useAuth } from "@/hooks/use-auth";
import { useActiveShift } from "@/hooks/use-active-shift";
import { useExperience } from "@/hooks/use-experience";
import { shouldBlockForShift } from "@/lib/shift-gate";
import { haptics } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { api, request } from "@/lib/api";
import type { ScanLog } from "@/types";

const PULL_THRESHOLD = 80;

type Props = {
  equipmentId: string;
  /** Suppress the in-pane Back button — the two-pane tablet layout owns navigation. */
  hideBack?: boolean;
};

export function EquipmentDetailScreen({ equipmentId, hideBack }: Props) {
  const { equipment, locationInference, isLoading, isError, refetch } =
    useEquipmentDetail(equipmentId);
  const dir = useDirection();
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const { hasActiveShift, isLoading: shiftLoading, isError: shiftError } = useActiveShift();
  const { can } = useExperience();
  const [issueOpen, setIssueOpen] = useState(false);

  // Scanner "Mark Issue" deep-links ?action=issue; only the desktop page read
  // it before, so the button no-oped on native (Phase 7 #1).
  useEffect(() => {
    if (new URLSearchParams(searchStr).get("action") === "issue") setIssueOpen(true);
  }, [searchStr]);

  // Reservation-ready push deep-links here; without the banner the notified
  // user had no way to claim on native (Phase 7 #2). Same query key as the
  // desktop page so the caches share.
  const waitlistQ = useQuery({
    queryKey: ["equipment-waitlist", equipmentId],
    queryFn: () => api.equipment.waitlist(equipmentId),
    enabled: !!equipmentId && !!userId,
    refetchOnWindowFocus: false,
  });
  const showReservationBanner = shouldShowReservationBanner(
    waitlistQ.data?.myStatus,
    waitlistQ.data?.reservationExpiresAt,
  );

  const checkoutMut = useMutation({
    mutationFn: () => api.equipment.checkout(equipmentId),
    onSuccess: (res) => {
      haptics.tap();
      queryClient.setQueryData([`/api/equipment/${equipmentId}`], res.equipment);
      queryClient.invalidateQueries({ queryKey: ["equipment-waitlist", equipmentId] });
      toast.success(
        res.pendingSyncId !== undefined
          ? t.equipmentDetail.toast.savedOffline
          : t.equipmentDetail.toast.checkedOut,
      );
    },
    onError: (err: Error) => {
      toast.error(t.equipmentDetail.toast.checkoutFailed(err.message));
    },
  });
  // Same off-shift ownership gate as EquipmentActions.handleCheckout (client
  // policy; actOffShift exempts; a shift-query error defers to the server).
  const handleReservationCheckout = () => {
    if (shiftLoading) return;
    if (
      shouldBlockForShift({
        hasActiveShift,
        shiftError,
        canActOffShift: can("equipment.actOffShift"),
      })
    ) {
      toast.error(t.scan.offShiftBody);
      return;
    }
    checkoutMut.mutate();
  };
  // Detail is normally reached from the equipment list; on a deep-link entry
  // there is no in-app history to pop, so fall back to the list.
  const handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/equipment");
  };

  const logsQuery = useQuery({
    queryKey: [`/api/equipment/${equipmentId}/logs`],
    queryFn: () => request<ScanLog[]>(`/api/equipment/${equipmentId}/logs`),
    enabled: !!equipmentId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const startY = useRef<number | null>(null);
  const [pullDelta, setPullDelta] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function onTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    startY.current = touch.clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    const delta = touch.clientY - startY.current;
    if (delta > 0) setPullDelta(Math.min(delta, PULL_THRESHOLD * 1.5));
  }

  async function onTouchEnd() {
    if (pullDelta >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      try {
        await refetch();
      } finally {
        setRefreshing(false);
      }
    }
    startY.current = null;
    setPullDelta(0);
  }

  const displayName = equipment ? getEquipmentDisplayName(equipment) : "";

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
        minHeight: "100%",
      }}
    >
      {!hideBack && (
        <button
          type="button"
          data-testid="btn-detail-back"
          onClick={handleBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            alignSelf: "flex-start",
            minHeight: 44,
            border: "none",
            background: "transparent",
            padding: "0 4px 0 0",
            cursor: "pointer",
            color: "hsl(var(--primary))",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <BackIcon size={18} strokeWidth={2.2} aria-hidden />
          {t.equipmentDetail.back}
        </button>
      )}

      {pullDelta > 0 && (
        <div
          style={{
            height: pullDelta / 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "hsl(var(--muted-foreground))",
            fontSize: "var(--text-xs)",
            transition: "height 80ms ease",
          }}
        >
          {pullDelta >= PULL_THRESHOLD
            ? `↑ ${t.equipmentDetail.releaseToRefresh}`
            : `↓ ${t.equipmentDetail.pullToRefresh}`}
        </div>
      )}

      {isLoading ? (
        <LoadingSection rows={4} />
      ) : isError ? (
        <ErrorCard message={t.errorCard.defaultMessage} onRetry={refetch} />
      ) : equipment ? (
        <>
          <h1
            style={{
              fontSize: "var(--text-2xl)",
              fontWeight: 800,
              color: "hsl(var(--foreground))",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {displayName}
          </h1>

          <EquipmentMetaStrip equipment={equipment} />

          {showReservationBanner && waitlistQ.data?.reservationExpiresAt && (
            <ReservationBanner
              equipmentId={equipment.id}
              expiresAt={waitlistQ.data.reservationExpiresAt}
              onCheckout={handleReservationCheckout}
              checkoutPending={checkoutMut.isPending}
              showNextInLine={waitlistQ.data.myPosition === 1}
            />
          )}

          {locationInference && (
            <EquipmentLocationCard inference={locationInference} />
          )}

          <EquipmentServiceCard equipment={equipment} />

          <EquipmentGlanceGrid equipment={equipment} inference={locationInference} />

          {logsQuery.data && logsQuery.data.length > 0 && (
            <EquipmentAccountabilityTimeline logs={logsQuery.data} />
          )}

          <EquipmentActions equipment={equipment} />

          <Button
            variant="outline"
            size="lg"
            className="w-full gap-2"
            onClick={() => setIssueOpen(true)}
            data-testid="btn-detail-report-issue"
          >
            <Flag className="h-5 w-5" />
            {t.qrScanner.reportIssue}
          </Button>

          <ReportEquipmentIssueSheet
            equipment={equipment}
            open={issueOpen}
            onOpenChange={setIssueOpen}
          />
        </>
      ) : null}
    </div>
  );
}
