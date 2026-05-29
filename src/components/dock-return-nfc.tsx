import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConditionChecklist } from "@/components/equipment/ConditionChecklist";
import {
  decodeNdefTextFromReadingEvent,
  decodeNdefUrlFromReadingEvent,
} from "@/lib/nfc-equipment-toggle";
import type { Equipment } from "@/types";
import { haptics } from "@/lib/haptics";

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

export function DockReturnNfc({ equipment, open, onClose, onSuccess }: DockReturnNfcProps) {
  const queryClient = useQueryClient();
  const [verifications, setVerifications] = useState<ConditionEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;

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
    mutationFn: (masterNfcTagId: string) =>
      api.operationalState.dockReturn(equipment.id, {
        masterNfcTagId,
        conditionVerifications: verifications,
      }),
    onSuccess: () => {
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

  const scanMasterTag = async () => {
    if (!nfcSupported) {
      toast.error(t.equipmentNfc.writeUnsupported);
      return;
    }
    setScanning(true);
    try {
      const masterNfcTagId = await new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("timeout")), 15_000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ndef = new (window as any).NDEFReader();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ndef.onreading = (event: any) => {
          window.clearTimeout(timeout);
          const textTag = decodeNdefTextFromReadingEvent(event);
          if (textTag) {
            resolve(textTag);
            return;
          }
          const url = decodeNdefUrlFromReadingEvent(event);
          if (url) {
            resolve(url.trim());
            return;
          }
          reject(new Error("no_tag"));
        };
        void ndef.scan().catch(reject);
      });
      await dockReturnMut.mutateAsync(masterNfcTagId);
    } catch {
      haptics.error();
      toast.error(t.dockReturn.scanDockFailed);
    } finally {
      setScanning(false);
    }
  };

  if (!open) return null;

  const conditions = conditionsQ.data ?? [];
  const existingStates = conditionStatesQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.dockReturn.nfcConfirmTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t.dockReturn.scanDockMasterTag}</p>

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
          <Button onClick={() => void scanMasterTag()} disabled={dockReturnMut.isPending || scanning}>
            {t.dockReturn.scanDockMasterTag}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
