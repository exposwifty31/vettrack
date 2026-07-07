import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractEquipmentId } from "@/lib/equipment-id";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import {
  markNfcToggleFired,
  runEquipmentQuickToggle,
  wasNfcToggleFiredRecently,
} from "@/lib/nfc-equipment-toggle";
import { getCachedEquipmentById } from "@/lib/offline-db";
import { useNfcSupported } from "@/hooks/use-nfc-supported";
import { startNfcScanSession } from "@/lib/nfc-platform";

type NfcTriggerArgs = { enabled: boolean; starting: boolean; toggle: () => void };

/**
 * Owns the foreground equipment-NFC scan session (single owner per device) and
 * exposes its state + toggle through `renderTrigger`, so the trigger can live in
 * the NativeHeader (native) or a floating FAB (web) — mirroring the shift-chat
 * launcher/FAB split.
 */
export function NfcForegroundScan({ renderTrigger }: { renderTrigger: (args: NfcTriggerArgs) => ReactNode }) {
  const queryClient = useQueryClient();
  const { supported: nfcSupported } = useNfcSupported();
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const activeRef = useRef(false);
  const handlerRef = useRef<(equipmentId: string) => void>(() => {});
  const scanAbortRef = useRef<AbortController | null>(null);
  const sessionStopRef = useRef<(() => Promise<void>) | null>(null);

  const stopScan = useCallback(() => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    void sessionStopRef.current?.();
    sessionStopRef.current = null;
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
      const session = await startNfcScanSession({
        signal: controller.signal,
        onRead: async (payload) => {
          const url = payload.url;
          if (!url) return;
          const equipmentId = extractEquipmentId(url);
          if (!equipmentId) return;
          await handlerRef.current(equipmentId);
        },
      });
      sessionStopRef.current = session.stop;
      activeRef.current = true;
      setEnabled(true);
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
  const toggle = () => {
    if (enabled) stopScan();
    else void startScan();
  };
  return <>{renderTrigger({ enabled, starting, toggle })}</>;
}

/**
 * Floating NFC toggle for the DESKTOP / web shell (no NativeHeader there). Native
 * shells render the toggle in NativeHeader instead — one NFC session owner per
 * platform. Page-gated to the equipment surfaces on web where a corner FAB would
 * otherwise crowd content.
 */
export function NfcForegroundScanFab() {
  const [location] = useLocation();
  if (!location.startsWith("/equipment") && !location.startsWith("/scan")) return null;
  return (
    <NfcForegroundScan
      renderTrigger={({ enabled, starting, toggle }) => (
        <div className="fixed bottom-nav-float-2 end-4 z-[60] md:bottom-6" data-testid="nfc-foreground-scan">
          <Button
            type="button"
            size="sm"
            variant={enabled ? "default" : "outline"}
            className="shadow-md gap-1.5 min-h-11 min-w-11 h-11"
            onClick={toggle}
            disabled={starting}
            aria-pressed={enabled}
          >
            <Radio className="w-4 h-4" />
            {enabled ? t.equipmentNfc.scanReady : t.equipmentNfc.enableScan}
          </Button>
        </div>
      )}
    />
  );
}
