import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractEquipmentId } from "@/components/qr-scanner";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import {
  decodeNdefUrlFromReadingEvent,
  markNfcToggleFired,
  runEquipmentQuickToggle,
  wasNfcToggleFiredRecently,
} from "@/lib/nfc-equipment-toggle";
import { getCachedEquipmentById } from "@/lib/offline-db";

export function NfcForegroundScan() {
  const queryClient = useQueryClient();
  const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const activeRef = useRef(false);
  const handlerRef = useRef<(equipmentId: string) => void>(() => {});
  const scanAbortRef = useRef<AbortController | null>(null);

  const stopScan = useCallback(() => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    activeRef.current = false;
    setEnabled(false);
  }, []);

  const handleEquipmentId = useCallback(
    async (equipmentId: string) => {
      if (wasNfcToggleFiredRecently(equipmentId)) return;
      markNfcToggleFired(equipmentId);
      const cached = await getCachedEquipmentById(equipmentId).catch(() => undefined);
      const name = cached?.name ?? equipmentId;
      await runEquipmentQuickToggle(equipmentId, name, queryClient);
    },
    [queryClient],
  );

  useEffect(() => {
    handlerRef.current = handleEquipmentId;
  }, [handleEquipmentId]);

  useEffect(() => {
    if (!enabled || !nfcSupported) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopScan();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, nfcSupported, stopScan]);

  useEffect(() => {
    return () => {
      stopScan();
    };
  }, [stopScan]);

  const startScan = async () => {
    if (!nfcSupported || activeRef.current) return;
    setStarting(true);
    const controller = new AbortController();
    scanAbortRef.current = controller;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ndef = new (window as any).NDEFReader();
      await ndef.scan({ signal: controller.signal });
      activeRef.current = true;
      setEnabled(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ndef.onreading = async (event: any) => {
        const url = decodeNdefUrlFromReadingEvent(event);
        if (!url) return;
        const equipmentId = extractEquipmentId(url);
        if (!equipmentId) return;
        await handlerRef.current(equipmentId);
      };
      haptics.scanSuccess();
      toast.success(t.equipmentNfc.scanReady, { duration: 3200 });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      haptics.error();
      toast.error(t.equipmentNfc.scanStartFailed);
      stopScan();
    } finally {
      setStarting(false);
    }
  };

  if (!nfcSupported) return null;

  return (
    <div className="fixed bottom-20 end-4 z-40 md:bottom-6" data-testid="nfc-foreground-scan">
      <Button
        type="button"
        size="sm"
        variant={enabled ? "default" : "outline"}
        className="shadow-md gap-1.5 h-10"
        onClick={() => {
          if (enabled) stopScan();
          else void startScan();
        }}
        disabled={starting}
        aria-pressed={enabled}
      >
        <Radio className="w-4 h-4" />
        {enabled ? t.equipmentNfc.scanReady : t.equipmentNfc.enableScan}
      </Button>
    </div>
  );
}
