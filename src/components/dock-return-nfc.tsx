import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConditionChecklist } from "@/components/equipment/ConditionChecklist";
import { useNfcSupported } from "@/hooks/use-nfc-supported";
import { readNfcOnce, resolveNfcTagId } from "@/lib/nfc-platform";
import type { Equipment } from "@/types";
import { haptics } from "@/lib/haptics";
import { useLocation } from "wouter";

interface DockReturnNfcProps {
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

type AmbiguousDock = { id: string; name: string };

function parseAmbiguousDocks(err: unknown): AmbiguousDock[] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  if (err.code !== "operationalState.ambiguousDocks") return null;
  const docks = err.payload.docks;
  if (!Array.isArray(docks)) return null;
  return docks.filter(
    (d): d is AmbiguousDock =>
      typeof d === "object" &&
      d !== null &&
      typeof (d as AmbiguousDock).id === "string" &&
      typeof (d as AmbiguousDock).name === "string",
  );
}

export function DockReturnNfc({ equipment, open, onClose, onSuccess }: DockReturnNfcProps) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [verifications, setVerifications] = useState<ConditionEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [ambiguousDocks, setAmbiguousDocks] = useState<AmbiguousDock[] | null>(null);
  const [pickedDockId, setPickedDockId] = useState("");
  const { supported: nfcSupported } = useNfcSupported();

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
    mutationFn: (payload: { masterNfcTagId?: string; dockId?: string }) =>
      api.operationalState.dockReturn(equipment.id, {
        ...payload,
        conditionVerifications: verifications,
      }),
    onSuccess: () => {
      setAmbiguousDocks(null);
      setPickedDockId("");
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipment.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["deployability", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["condition-states", equipment.id] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue", equipment.id] });
      haptics.scanSuccess();
      toast.success(t.dockReturn.success);
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      haptics.error();
      const docks = parseAmbiguousDocks(err);
      if (docks && docks.length > 0) {
        setAmbiguousDocks(docks);
        setPickedDockId("");
        toast.message(t.operationalState.ambiguousDocks);
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t.dockReturn.versionConflict);
        return;
      }
      if (err instanceof ApiError && err.status === 422) {
        toast.error(t.dockReturn.notReadyAfterReturn);
        return;
      }
      toast.error(t.dockReturn.notReadyAfterReturn);
    },
  });

  const submitDockReturn = async (payload: { masterNfcTagId?: string; dockId?: string }) => {
    try {
      await dockReturnMut.mutateAsync(payload);
    } catch {
      // onError handles user-facing toasts
    }
  };

  const scanMasterTag = async () => {
    if (!nfcSupported) {
      toast.error(t.equipmentNfc.writeUnsupported);
      return;
    }
    setScanning(true);
    setAmbiguousDocks(null);
    try {
      const payload = await readNfcOnce({ timeoutMs: 15_000 });
      const masterNfcTagId = resolveNfcTagId(payload);
      if (!masterNfcTagId) throw new Error("no_tag");
      await submitDockReturn({ masterNfcTagId });
    } catch (err) {
      if (err instanceof ApiError) return;
      haptics.error();
      toast.error(t.dockReturn.scanDockFailed);
    } finally {
      setScanning(false);
    }
  };

  if (!open) return null;

  if (!equipment.assetTypeId) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.dockReturn.nfcConfirmTitle}</DialogTitle>
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
          <DialogTitle>{t.dockReturn.nfcConfirmTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t.dockReturn.scanDockMasterTag}</p>

        {ambiguousDocks && ambiguousDocks.length > 0 ? (
          <div>
            <p className="text-sm text-amber-700 mb-2">{t.operationalState.ambiguousDocks}</p>
            <Select value={pickedDockId} onValueChange={setPickedDockId}>
              <SelectTrigger>
                <SelectValue placeholder={t.dockReturn.selectDock} />
              </SelectTrigger>
              <SelectContent>
                {ambiguousDocks.map((dock) => (
                  <SelectItem key={dock.id} value={dock.id}>
                    {dock.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

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

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={dockReturnMut.isPending || scanning}>
            {t.common.cancel}
          </Button>
          {ambiguousDocks && ambiguousDocks.length > 0 ? (
            <Button
              onClick={() => void submitDockReturn({ dockId: pickedDockId })}
              disabled={!pickedDockId || dockReturnMut.isPending}
            >
              {t.dockReturn.submit}
            </Button>
          ) : (
            <Button onClick={() => void scanMasterTag()} disabled={dockReturnMut.isPending || scanning}>
              {t.dockReturn.scanDockMasterTag}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
