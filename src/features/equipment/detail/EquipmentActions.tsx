import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import type { Equipment } from "@/types";

type Props = {
  equipment: Equipment;
};

/**
 * Stage 6 detail actions. Ships the primary "Check in" (return) action — the
 * only equipment-scoped mutation available as a reusable, verifiable unit
 * (`api.equipment.return` + the standalone ReturnPlugDialog, same optimistic /
 * offline path the desktop uses). Return is intentionally NOT shift-gated —
 * you can always hand equipment back. Flag/Report-missing are deferred: the
 * equipment-scoped issue flow (note + photo) lives only in the desktop screen,
 * and "report missing" has no endpoint yet.
 */
export function EquipmentActions({ equipment }: Props) {
  const { userId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [returnOpen, setReturnOpen] = useState(false);

  const isCheckedOut = !!equipment.checkedOutById;
  const checkedOutByMe = !!userId && equipment.checkedOutById === userId;
  const canReturn = isCheckedOut && (checkedOutByMe || isAdmin);

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

  if (!canReturn) return null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

      <ReturnPlugDialog
        open={returnOpen}
        equipmentName={equipment.name}
        isSubmitting={returnMut.isPending}
        onOpenChange={setReturnOpen}
        onConfirm={(values) => returnMut.mutate(values)}
      />
    </section>
  );
}
