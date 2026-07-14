import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnifiedReturnDialog } from "@/components/equipment/UnifiedReturnDialog";
import { useAuth } from "@/hooks/use-auth";
import { useActiveShift } from "@/hooks/use-active-shift";
import { api, ApiError } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import type { Equipment } from "@/types";

type Props = {
  equipment: Equipment;
};

/**
 * Mobile detail actions. Two equipment-scoped mutations, gated by custody state:
 *  - "Check in" (return) for an item the viewer holds (or any item, for admins);
 *    NOT shift-gated — you can always hand equipment back. Opens
 *    `UnifiedReturnDialog` (T2.3-mobile, docking P2): a home-station toggle
 *    collapses the plain return and dock-return flows into one sheet —
 *    checked routes to the online-only dock-return endpoint (handled
 *    entirely inside the dialog); unchecked routes back through this file's
 *    own `returnMut` (`onConfirmReturn`) so the offline-capable
 *    `api.equipment.return` path (pendingSyncId / savedOffline toast) is
 *    preserved exactly as before.
 *  - "Check out" (take) for an available item at its dock — mirrors the
 *    equipment-list quick-action gate: not held, status ok, not `returned`
 *    (that path prompts Dock Return first), and on an active roster shift.
 * Flag/Report-missing remain desktop-only.
 */
export function EquipmentActions({ equipment }: Props) {
  const { userId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [returnOpen, setReturnOpen] = useState(false);
  const { hasActiveShift, isLoading: shiftLoading, isError: shiftError } = useActiveShift();

  const isCheckedOut = !!equipment.checkedOutById;
  const checkedOutByMe = !!userId && equipment.checkedOutById === userId;
  const canReturn = isCheckedOut && (checkedOutByMe || isAdmin);
  const canCheckout =
    !isCheckedOut && equipment.status === "ok" && equipment.custodyState !== "returned";
  // Resting + homed only — a held item is accounted for, and hidden for
  // non-docking clinics (no homeRoomId means no home station to report against).
  const canReportNotFound = !isCheckedOut && !!equipment.homeRoomId;

  const returnMut = useMutation({
    mutationFn: (values: { isPluggedIn: boolean; plugInDeadlineMinutes?: number }) =>
      api.equipment.return(equipment.id, values),
    onSuccess: (res) => {
      haptics.tap();
      queryClient.setQueryData([`/api/equipment/${equipment.id}`], res.equipment);
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}`] });
      setReturnOpen(false);
      toast.success(
        res.pendingSyncId !== undefined
          ? t.equipmentDetail.toast.savedOffline
          : t.equipmentDetail.toast.returned,
      );
    },
    onError: () => toast.error(t.equipmentDetail.toast.returnFailed("")),
  });

  const checkoutMut = useMutation({
    mutationFn: () => api.equipment.checkout(equipment.id),
    onSuccess: (res) => {
      haptics.tap();
      queryClient.setQueryData([`/api/equipment/${equipment.id}`], res.equipment);
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(
        res.pendingSyncId !== undefined
          ? t.equipmentDetail.toast.savedOffline
          : t.scanner.toast.checkedOut(equipment.name),
      );
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "";
      toast.error(t.equipmentDetail.toast.checkoutFailed(message));
    },
  });

  const notFoundMut = useMutation({
    mutationFn: () => api.docking.notFoundHere(equipment.id),
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.equipmentDetail.toast.reportedNotFound);
    },
    onError: () => toast.error(t.equipmentDetail.toast.returnFailed("")),
  });

  // Off-shift ownership is not permitted (roster gate). Stay quiet while the
  // shift query resolves; only a *successful* no-shift read blocks client-side —
  // a shift-query error defers to the server's authoritative gate (fail loud).
  const handleCheckout = () => {
    if (shiftLoading) return;
    if (!shiftError && !hasActiveShift) {
      toast.error(t.scan.offShiftBody);
      return;
    }
    checkoutMut.mutate();
  };

  if (!canReturn && !canCheckout && !canReportNotFound) return null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {canCheckout && (
        <Button
          variant="action"
          size="lg"
          className="w-full gap-2"
          onClick={handleCheckout}
          disabled={checkoutMut.isPending || shiftLoading}
          data-testid="btn-detail-checkout"
        >
          <LogIn className="h-5 w-5" />
          {t.equipmentList.quickAction.checkout}
        </Button>
      )}

      {canReturn && (
        <Button
          variant="action"
          size="lg"
          className="w-full gap-2"
          onClick={() => setReturnOpen(true)}
          disabled={returnMut.isPending}
          data-testid="btn-detail-checkin"
        >
          <LogOut className="h-5 w-5" />
          {t.equipmentDetail.checkIn}
        </Button>
      )}

      {canReportNotFound && (
        <Button
          variant="outline"
          size="lg"
          className="w-full gap-2"
          onClick={() => notFoundMut.mutate()}
          disabled={notFoundMut.isPending}
          data-testid="btn-detail-not-found-here"
        >
          <SearchX className="h-5 w-5" />
          {t.equipmentDetail.notFoundHere}
        </Button>
      )}

      {canReturn && (
        <UnifiedReturnDialog
          open={returnOpen}
          equipment={equipment}
          equipmentName={equipment.name}
          isSubmitting={returnMut.isPending}
          onOpenChange={setReturnOpen}
          // Unchecked (no home-station) path — routed through the same
          // offline-capable returnMut as before (api.equipment.return,
          // pendingSyncId/savedOffline toast). Do NOT let the dialog own this
          // path itself; the checked (dock-return) path below is online-only
          // and stays fully inside UnifiedReturnDialog.
          onConfirmReturn={(values) => returnMut.mutate(values)}
          onDockReturnSuccess={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}`] });
            queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
            queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
            queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
          }}
        />
      )}
    </section>
  );
}
