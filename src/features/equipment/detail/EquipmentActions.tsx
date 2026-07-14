import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
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
 *    NOT shift-gated — you can always hand equipment back.
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

  if (!canReturn && !canCheckout) return null;

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

      {canReturn && (
        <ReturnPlugDialog
          open={returnOpen}
          equipmentName={equipment.name}
          isSubmitting={returnMut.isPending}
          onOpenChange={setReturnOpen}
          onConfirm={(values) => returnMut.mutate(values)}
        />
      )}
    </section>
  );
}
