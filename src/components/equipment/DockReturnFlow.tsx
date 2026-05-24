import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConditionChecklist } from "./ConditionChecklist";
import type { Equipment } from "@/types";

interface DockReturnFlowProps {
  equipment: Equipment;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ConditionEntry {
  conditionId: string;
  verified: boolean;
  notes?: string;
}

export function DockReturnFlow({ equipment, open, onClose, onSuccess }: DockReturnFlowProps) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [dockId, setDockId] = useState<string>("");
  const [verifications, setVerifications] = useState<ConditionEntry[]>([]);

  const docksQ = useQuery({
    queryKey: ["/api/docks"],
    queryFn: api.operationalState.listDocks,
    enabled: open,
  });

  const conditionsQ = useQuery({
    queryKey: ["/api/asset-types", equipment.assetTypeId, "conditions"],
    queryFn: () => api.operationalState.listConditions(equipment.assetTypeId!),
    enabled: open && !!equipment.assetTypeId,
  });

  const conditionStatesQ = useQuery({
    queryKey: ["condition-states", equipment.id],
    queryFn: () => api.operationalState.conditionStates(equipment.id),
    enabled: open && !!equipment.assetTypeId,
  });

  const dockReturnMut = useMutation({
    mutationFn: () =>
      api.operationalState.dockReturn(equipment.id, {
        dockId,
        conditionVerifications: verifications,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["deployability", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["condition-states", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue", equipment.id] });
      toast.success(t.dockReturn.success);
      onSuccess?.();
      onClose();
    },
    onError: () => toast.error(t.dockReturn.notReadyAfterReturn),
  });

  if (!open) return null;

  if (!equipment.assetTypeId) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.dockReturn.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t.dockReturn.noAssetTypeBlocked}</p>
          <Button variant="outline" onClick={() => { onClose(); navigate("/admin/asset-types"); }}>
            {t.dockReturn.goToSetup}
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  const conditions = conditionsQ.data ?? [];
  const existingStates = conditionStatesQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.dockReturn.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t.dockReturn.selectDock}</label>
            <Select value={dockId} onValueChange={setDockId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t.dockReturn.selectDock} />
              </SelectTrigger>
              <SelectContent>
                {(docksQ.data ?? []).map((dock) => (
                  <SelectItem key={dock.id} value={dock.id}>
                    {dock.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">{t.dockReturn.conditions}</p>
            {conditions.length === 0 ? (
              <p className="text-xs text-amber-600">{t.dockReturn.noConditionsWarning}</p>
            ) : (
              <ConditionChecklist
                conditions={conditions}
                existingStates={existingStates}
                value={verifications}
                onChange={setVerifications}
              />
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={dockReturnMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => dockReturnMut.mutate()}
            disabled={!dockId || dockReturnMut.isPending}
          >
            {t.dockReturn.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
