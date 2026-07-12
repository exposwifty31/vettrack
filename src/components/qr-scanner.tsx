import { t } from "@/lib/i18n";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Flashlight,
  FlashlightOff,
  Keyboard,
  Camera,
  AlertCircle,
  Loader2,
  LogIn,
  LogOut,
  Wrench,
  CheckCircle2,
  Sparkles,
  ScanSearch,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { extractEquipmentId } from "@/lib/equipment-id";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import type { Equipment } from "@/types";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { haptics } from "@/lib/haptics";
import { isOnline } from "@/lib/safe-browser";
import { FirstScanCelebration } from "@/components/first-scan-celebration";
import {
  hasCelebratedFirstScanToday,
  markFirstScanCelebratedToday,
} from "@/lib/first-scan-day";
import type { HomeDashboardPulse } from "@/types/tasks";

interface QrScannerProps {
  onClose: () => void;
  /** Called when the scanned code resolves to an inventory container. Caller should open DispenseSheet for the returned containerId. */
  onDispense?: (containerId: string) => void;
}

type ScannerPhase =
  | "init"
  | "scanning"
  | "resolving"
  | "permission_denied"
  | "no_camera"
  | "error"
  | "not_found"
  | "manual"
  | "first_scan_celebration"
  | "result";

const DEBOUNCE_MS = 300;

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

function getFirstVideoTrack(scanner: Html5Qrcode): MediaStreamTrack | null {
  const el = (scanner as Html5Qrcode & { videoElement?: HTMLVideoElement })
    .videoElement;
  const stream = el?.srcObject;
  if (!stream || !(stream instanceof MediaStream)) return null;
  const tracks = stream.getVideoTracks();
  return tracks[0] ?? null;
}

function trackSupportsTorch(track: MediaStreamTrack): boolean {
  const caps = track.getCapabilities?.() as ExtendedMediaTrackCapabilities | undefined;
  return caps?.torch !== undefined;
}

// Single source of truth lives in @/lib/equipment-id (pure, zero heavy imports) so the
// dynamically-imported deep-link-router chunk never drags html5-qrcode into native startup.
// Imported above for this file's own scanner uses; re-exported here so existing importers of
// "@/components/qr-scanner" (nfc-foreground-scan)
// keep resolving the symbol.
export { extractEquipmentId };

// Stop all active camera tracks by pulling them from the existing video element.
// Avoids requesting a new getUserMedia stream just to tear down the old one.
const killAllCameras = () => {
  const videoEl = document.querySelector("video") as HTMLVideoElement | null;
  const stream = videoEl?.srcObject;
  if (stream instanceof MediaStream) {
    stream.getTracks().forEach(track => {
      track.stop();
      track.enabled = false;
    });
  }
};

export function QrScanner({ onClose, onDispense }: QrScannerProps) {
  const [, navigate] = useLocation();
  const { userId, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<ScannerPhase>("init");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [scannedEquipment, setScannedEquipment] = useState<Equipment | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<number>(0);
  // Monotonic token identifying the current physical scan. Bumped on every
  // decode that clears the debounce, BEFORE the (possibly slow) network
  // resolve is awaited. A resolve is only applied if this ref still equals
  // the token it captured — a later scan bumping the token supersedes any
  // still-in-flight resolve from an earlier one, so the last PHYSICALLY
  // scanned tag always wins, never the last one to finish resolving.
  const scanTokenRef = useRef<number>(0);
  const stopScannerRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const [confirmFlash, setConfirmFlash] = useState(false);
  const [scanCountPop, setScanCountPop] = useState(false);
  const [pendingFirstScan, setPendingFirstScan] = useState(false);

  const { data: pulse } = useQuery({
    queryKey: ["/api/home/dashboard"],
    queryFn: () => api.home.dashboard(),
    enabled: !!userId,
    staleTime: 30_000,
  });
  const containerId = "qr-scanner-container";

  const navigateToEquipment = useCallback(
    (equipmentId: string, action?: string) => {
      onClose();
      if (action) {
        navigate(`/equipment/${equipmentId}?action=${action}`);
      } else {
        navigate(`/equipment/${equipmentId}`);
      }
    },
    [navigate, onClose]
  );

  const getEquipmentFromCache = useCallback(
    (equipmentId: string): Equipment | null => {
      const detail = queryClient.getQueryData<Equipment>([`/api/equipment/${equipmentId}`]);
      if (detail?.id === equipmentId) return detail;

      const cachedLists = queryClient.getQueriesData({
        queryKey: ["/api/equipment"],
      });
      for (const [, data] of cachedLists) {
        if (Array.isArray(data)) {
          const match = (data as Equipment[]).find((item) => item.id === equipmentId);
          if (match) return match;
          continue;
        }
        if (
          data &&
          typeof data === "object" &&
          "items" in data &&
          Array.isArray((data as { items: unknown[] }).items)
        ) {
          const match = ((data as { items: Equipment[] }).items).find((item) => item.id === equipmentId);
          if (match) return match;
        }
      }
      return null;
    },
    [queryClient]
  );

  const resolveEquipmentId = useCallback(
    async (equipmentId: string): Promise<Equipment | null> => {
      const cached = getEquipmentFromCache(equipmentId);
      if (cached) return cached;
      if (!isOnline()) return null;
      try {
        const equipment = await api.equipment.get(equipmentId);
        queryClient.setQueryData([`/api/equipment/${equipmentId}`], equipment);
        return equipment;
      } catch {
        return null;
      }
    },
    [getEquipmentFromCache, queryClient]
  );

  /**
   * resolveAsContainer — called as a fallback when the scanned code does not
   * match any equipment record.  Tries the containers API by NFC tag ID.
   * Returns the container id if found, null otherwise.
   */
  const resolveAsContainer = useCallback(
    async (tagId: string): Promise<string | null> => {
      if (!isOnline()) return null;
      try {
        const container = await api.containers.getByNfcTag(tagId);
        return container?.id ?? null;
      } catch {
        return null;
      }
    },
    []
  );

  const handleScanResult = useCallback(
    async (rawValue: string) => {
      const now = Date.now();
      if (now - lastScanRef.current < DEBOUNCE_MS) return;
      lastScanRef.current = now;

      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      const equipmentId = extractEquipmentId(rawValue);
      if (!equipmentId) {
        toast.error(t.qrScanner.unknownQrFormat);
        return;
      }

      // Claim this physical scan's token before the async resolve starts.
      const token = ++scanTokenRef.current;

      setPhase("resolving");
      // Stop the camera BEFORE awaiting the network resolve — narrows the
      // window in which another decode can fire while this one is in flight.
      // The token check below is the actual last-scanned-wins guarantee.
      await stopScannerRef.current();

      const eq = await resolveEquipmentId(equipmentId);
      if (scanTokenRef.current !== token) return; // superseded by a newer scan — discard

      if (!eq) {
        // Equipment not found — try resolving as an inventory container.
        // If successful, hand off to the dispense flow immediately (zero extra taps).
        if (onDispense) {
          const containerId = await resolveAsContainer(equipmentId);
          if (scanTokenRef.current !== token) return; // superseded while resolving container
          if (containerId) {
            haptics.scanSuccess();
            // Parent closes the scanner via state after onDispense — do not call onClose()
            // here or it may clear page-held context (e.g. ER quick-scan patient) before onDispense runs.
            onDispense(containerId);
            return;
          }
        }
        setNotFoundId(equipmentId);
        setPhase("not_found");
        return;
      }

      setConfirmFlash(true);
      setTimeout(() => setConfirmFlash(false), 260);
      setScannedEquipment(eq);

      const firstToday = !hasCelebratedFirstScanToday(userId);
      if (firstToday) {
        haptics.celebrate();
        markFirstScanCelebratedToday(userId);
        setPendingFirstScan(true);
        setPhase("first_scan_celebration");
      } else {
        haptics.scanSuccess();
        setPhase("result");
      }

      queryClient.setQueryData<HomeDashboardPulse | undefined>(
        ["/api/home/dashboard"],
        (old) => (old ? { ...old, scansToday: old.scansToday + 1 } : old),
      );
      setScanCountPop(true);
      setTimeout(() => setScanCountPop(false), 320);
      void queryClient.invalidateQueries({ queryKey: ["/api/home/dashboard"] });
    },
    [resolveEquipmentId, resolveAsContainer, onDispense, userId, queryClient]
  );

  const stopScanner = useCallback(async () => {
    // Nuclear first: kill all camera tracks before anything else so the iOS
    // orange dot disappears immediately, even if the library teardown is slow.
    killAllCameras();

    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state !== 1) { // 1 = NOT_STARTED / IDLE
          await scannerRef.current.stop();
        }
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    // Also clear the srcObject from the video element if it exists
    const videoEl = document.querySelector(`#${containerId} video`) as HTMLVideoElement | null;
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.load();
    }
    // Signal iOS PWA that the page context has changed — helps the system
    // reclaim the camera session in Standalone mode.
    window.dispatchEvent(new Event("locationchange"));
  }, []);

  stopScannerRef.current = stopScanner;

  const startScanner = useCallback(async () => {
    setPhase("init");

    // Heavy scanning lib (html5-qrcode) is loaded on demand so it stays out of
    // the eager route chunk on every page that mounts <QrScanner /> while closed.
    let Html5Qrcode: typeof import("html5-qrcode")["Html5Qrcode"];
    let Html5QrcodeScannerState: typeof import("html5-qrcode")["Html5QrcodeScannerState"];
    try {
      ({ Html5Qrcode, Html5QrcodeScannerState } = await import("html5-qrcode"));
    } catch (importErr) {
      console.error("Failed to load html5-qrcode module", importErr);
      setManualCode("");
      setPhase("manual");
      return;
    }

    if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
    initTimeoutRef.current = setTimeout(async () => {
      initTimeoutRef.current = null;
      if (scannerRef.current) {
        try {
          const state = scannerRef.current.getState();
          if (
            state === Html5QrcodeScannerState.SCANNING ||
            state === Html5QrcodeScannerState.PAUSED
          ) {
            return;
          }
          await scannerRef.current.stop().catch(() => {});
        } catch {
          // ignore
        }
        scannerRef.current = null;
      }
      setManualCode("");
      setPhase("manual");
    }, 8000);

    try {
      const scanner = new Html5Qrcode(containerId, { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          disableFlip: false,
        },
        (decodedText) => {
          handleScanResult(decodedText);
        },
        () => {}
      );

      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }

      setPhase("scanning");
      setShowFallbackHint(false);

      fallbackTimerRef.current = setTimeout(() => {
        setShowFallbackHint(true);
      }, 2000);

      try {
        const track = getFirstVideoTrack(scanner);
        if (track && trackSupportsTorch(track)) {
          setTorchSupported(true);
        }
      } catch {
        // torch check failed — that's fine
      }
    } catch (err: unknown) {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
      const msg = errorToString(err);
      if (
        msg.includes("Permission") ||
        msg.includes("NotAllowed") ||
        msg.includes("permission")
      ) {
        setPhase("permission_denied");
      } else if (
        msg.includes("NotFound") ||
        msg.includes("OverconstrainedError")
      ) {
        setPhase("no_camera");
      } else {
        setPhase("error");
      }
    }
  }, [handleScanResult]);

  useEffect(() => {
    startScanner();
    return () => {
      stopScanner();
    };
  }, []);

  // Kill camera immediately when the app is backgrounded or the screen is locked
  // (prevents the persistent iOS PWA "Recording" orange dot on minimize/lock), and
  // resume it on return. visibilitychange covers the common tab/app-switch case;
  // pageshow additionally covers BFCache restores that don't always re-fire
  // visibilitychange. Only resumes while still in the live-camera "scanning"
  // phase, and only if the camera isn't already running — guards against both
  // events firing for the same resume and mirrors the existing start path.
  useEffect(() => {
    const resumeCameraIfNeeded = () => {
      if (phase === "scanning" && !scannerRef.current) {
        startScanner();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopScannerRef.current();
      } else if (document.visibilityState === "visible") {
        resumeCameraIfNeeded();
      }
    };
    const handlePageShow = () => {
      resumeCameraIfNeeded();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [phase, startScanner]);

  const toggleTorch = async () => {
    if (!scannerRef.current) return;
    try {
      const track = getFirstVideoTrack(scannerRef.current);
      if (!track) return;
      interface TorchConstraint extends MediaTrackConstraintSet {
        torch?: boolean;
      }
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as TorchConstraint] });
      setTorchOn((prev) => !prev);
    } catch {
      toast.error(t.qrScanner.torchUnavailable);
    }
  };

  const handleManualSubmit = async () => {
    const raw = manualCode.trim();
    if (!raw) return;
    const equipmentId = extractEquipmentId(raw);
    if (!equipmentId) {
      toast.error(t.qrScanner.invalidCodeFormat);
      return;
    }
    setPhase("resolving");
    const eq = await resolveEquipmentId(equipmentId);
    if (!eq) {
      // Equipment not found — try resolving as an inventory container.
      if (onDispense) {
        const containerId = await resolveAsContainer(equipmentId);
        if (containerId) {
          haptics.scanSuccess();
          onDispense(containerId);
          return;
        }
      }
      setNotFoundId(equipmentId);
      setPhase("not_found");
      return;
    }
    haptics.scanSuccess();
    setConfirmFlash(true);
    setTimeout(() => setConfirmFlash(false), 260);
    setScannedEquipment(eq);
    setPhase("result");
  };

  const handleScanAgain = async () => {
    setNotFoundId(null);
    setScannedEquipment(null);
    setPhase("init");
    await stopScanner();
    setTimeout(() => startScanner(), 100);
  };

  const isCheckedOut = !!(scannedEquipment?.checkedOutById);
  const checkedOutByMe = scannedEquipment?.checkedOutById === userId;

  async function handleCheckout() {
    if (!scannedEquipment) return;
    setIsActing(true);
    try {
      await api.equipment.checkout(scannedEquipment.id);
      haptics.tap();
      toast.success(t.scanner.toast.checkedOut(scannedEquipment.name));
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      toast.error(msg);
      setIsActing(false);
    }
  }

  async function handleReturn() {
    if (!scannedEquipment) return;
    setReturnDialogOpen(true);
  }

  async function handleConfirmReturn(payload: {
    isPluggedIn: boolean;
    plugInDeadlineMinutes?: number;
  }) {
    if (!scannedEquipment) return;
    setIsActing(true);
    try {
      await api.equipment.return(scannedEquipment.id, {
        isPluggedIn: payload.isPluggedIn,
        plugInDeadlineMinutes: payload.plugInDeadlineMinutes,
      });
      haptics.tap();
      toast.success(t.scanner.toast.returned(scannedEquipment.name));
      setReturnDialogOpen(false);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Return failed";
      toast.error(msg);
    } finally {
      setIsActing(false);
    }
  }

  async function handleMarkOk() {
    if (!scannedEquipment) return;
    setIsActing(true);
    try {
      await api.equipment.scan(scannedEquipment.id, { status: "ok" });
      void api.equipment.seen(scannedEquipment.id, { roomId: scannedEquipment.roomId }).catch(() => {});
      haptics.tap();
      toast.success(t.qrScanner.markedOk(scannedEquipment.name));
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.qrScanner.statusUpdateFailed;
      toast.error(msg);
      setIsActing(false);
    }
  }

  function handleMarkIssue() {
    if (!scannedEquipment) return;
    navigateToEquipment(scannedEquipment.id, "issue");
  }

  // Rendered through a portal to document.body so the fixed overlay resolves
  // against the viewport, not the NativeShell scroll container. Inside that
  // container (-webkit-overflow-scrolling: touch) iOS scopes position:fixed to
  // the scroller, which pushed the manual-entry footer off-screen under the tab
  // bar. Portaling restores true full-screen behavior on every entry point.
  return createPortal(
    <div className="fixed inset-0 qr-scanner-overlay-root z-50 bg-black flex flex-col motion-safe:animate-page-enter" data-testid="qr-scanner-overlay">
      {confirmFlash && <div className="pointer-events-none absolute inset-0 z-50 bg-[hsl(var(--status-ok))]/20 animate-pulse" />}
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 pb-3 bg-gradient-to-b from-black/95 to-black/65 backdrop-blur-sm" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
        <div className="flex flex-col">
          <span className="text-white font-semibold text-lg">{t.qrScanner.title}</span>
          <span className="text-xs uppercase tracking-[0.16em] text-white/70">
            {t.qrScanner.subtitleEquipmentQr}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {(phase === "init" || phase === "resolving") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 gap-1.5 px-2.5 text-white hover:bg-white/10"
              onClick={() => {
                stopScanner();
                setPhase("manual");
              }}
              data-testid="btn-switch-manual-header"
            >
              <Keyboard className="w-4 h-4 shrink-0" aria-hidden />
              <span className="text-xs font-semibold">{t.qrScanner.manualEnterButton}</span>
            </Button>
          )}
          {torchSupported && phase === "scanning" && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-10 w-10 text-white hover:bg-white/10"
              onClick={toggleTorch}
              data-testid="btn-torch-toggle"
            >
              {torchOn ? (
                <FlashlightOff className="w-5 h-5" />
              ) : (
                <Flashlight className="w-5 h-5" />
              )}
            </Button>
          )}
          {/* BUG-004: the close control must always be a ≥44px touch target and
              stay reachable on iPhone (rendered in the always-visible header). */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-11 w-11 text-white hover:bg-white/10"
            onClick={onClose}
            data-testid="btn-scanner-cancel"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Camera viewport — collapsed (not display:none) during manual/result so the
          container div keeps its DOM presence for html5-qrcode re-init */}
      <div
        className={`relative flex items-center justify-center bg-black overflow-hidden ${
          phase === "manual" || phase === "result" || phase === "first_scan_celebration"
            ? "flex-none h-0"
            : "flex-1 min-h-0"
        }`}
      >
        <div id={containerId} className="w-full h-full" />

        {/* Loading */}
        {phase === "init" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="flex flex-col items-center gap-3 text-white">
              <Loader2 className="w-10 h-10 animate-spin" />
              <p className="text-sm font-medium">{t.qrScanner.startingCamera}</p>
            </div>
          </div>
        )}

        {/* Resolving scan */}
        {phase === "resolving" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/15 bg-black/70 px-6 py-5 text-white">
              <div className="relative">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <ScanSearch className="w-4 h-4 absolute -bottom-1 -right-1 text-white/90" />
              </div>
              <p className="text-sm font-semibold">{t.qrScanner.lookingUp}</p>
              <p className="text-xs text-white/60">{t.qrScanner.oneMoment}</p>
            </div>
          </div>
        )}

        {/* Permission denied */}
        {phase === "permission_denied" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-6">
            <div className="flex flex-col items-center gap-4 text-center text-white max-w-xs">
              <Camera className="w-14 h-14 text-white/60" />
              <p className="font-bold text-lg">{t.qrScanner.permissionDeniedTitle}</p>
              <p className="text-sm text-white/70">
                {t.qrScanner.permissionDeniedDesc}
              </p>
              <Button
                variant="outline"
                className="text-white border-white/40 bg-white/10 hover:bg-white/20 gap-2 mt-2"
                onClick={() => stopScanner().then(() => setPhase("manual"))}
                data-testid="btn-manual-entry"
              >
                <Keyboard className="w-4 h-4" />
                {t.qrScanner.manualEnterButton}
              </Button>
            </div>
          </div>
        )}

        {/* No camera */}
        {phase === "no_camera" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-6">
            <div className="flex flex-col items-center gap-4 text-center text-white max-w-xs">
              <AlertCircle className="w-14 h-14 text-white/60" />
              <p className="font-bold text-lg">{t.qrScanner.noCameraTitle}</p>
              <p className="text-sm text-white/70">
                {t.qrScanner.noCameraDesc}
              </p>
              <Button
                variant="outline"
                className="text-white border-white/40 bg-white/10 hover:bg-white/20 gap-2 mt-2"
                onClick={() => setPhase("manual")}
                data-testid="btn-manual-entry-no-camera"
              >
                <Keyboard className="w-4 h-4" />
                {t.qrScanner.manualEnterButton}
              </Button>
            </div>
          </div>
        )}

        {/* Generic error */}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-6">
            <div className="flex flex-col items-center gap-4 text-center text-white max-w-xs">
              <AlertCircle className="w-14 h-14 text-[hsl(var(--status-issue))]" />
              <p className="font-bold text-lg">{t.qrScanner.cameraErrorTitle}</p>
              <p className="text-sm text-white/70">
                {t.qrScanner.cameraErrorDesc}
              </p>
              <div className="flex flex-col gap-2 w-full mt-2">
                <Button
                  className="gap-2"
                  onClick={() => {
                    stopScanner().then(() => startScanner());
                  }}
                >
                  {t.qrScanner.tryAgain}
                </Button>
                <Button
                  variant="outline"
                  className="text-white border-white/40 bg-white/10 hover:bg-white/20 gap-2"
                  onClick={() => {
                    setManualCode("");
                    stopScanner().then(() => setPhase("manual"));
                  }}
                >
                  <Keyboard className="w-4 h-4" />
                  {t.qrScanner.manualEnterButton}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Equipment not found */}
        {phase === "not_found" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-6">
            <div className="flex flex-col items-center gap-4 text-center text-white max-w-xs">
              <Tag className="w-14 h-14 text-[hsl(var(--status-stale))]" />
              <p className="font-bold text-lg">{t.qrScanner.unknownTagTitle}</p>
              <p className="text-sm text-white/70">
                {t.qrScanner.unknownTagDesc}
              </p>
              {notFoundId ? (
                <p className="w-full max-w-full break-all rounded-lg bg-white/5 px-2 py-1.5 text-left font-mono text-xs text-white/90">
                  {notFoundId}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 w-full mt-2">
                <Button
                  className="gap-2"
                  onClick={handleScanAgain}
                  data-testid="btn-scan-again"
                >
                  {t.qrScanner.scanAgain}
                </Button>
                <Button
                  variant="outline"
                  className="text-white border-white/40 bg-white/10 hover:bg-white/20 gap-2"
                  onClick={() => {
                    setManualCode("");
                    stopScanner().then(() => setPhase("manual"));
                  }}
                >
                  <Keyboard className="w-4 h-4" />
                  {t.qrScanner.manualEnterButton}
                </Button>
                <Button
                  variant="secondary"
                  className="gap-2"
                  onClick={() => {
                    onClose();
                    navigate(`/equipment/new?prefillId=${encodeURIComponent(notFoundId || "")}`);
                  }}
                >
                  {t.qrScanner.linkToEquipment}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Scanning guide overlay — z-10 ensures it sits above html5-qrcode's injected video UI */}
        {phase === "scanning" && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            <div
              className="relative flex-shrink-0"
              style={{
                width: 250,
                height: 250,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.58)",
                borderRadius: "18px",
              }}
            >
              {/* Corner brackets — white reticle on the darkened camera mask */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" aria-hidden="true" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" aria-hidden="true" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" aria-hidden="true" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" aria-hidden="true" />
              {/* Animated scan line — the surrounding `phase === "scanning"` gate
                  unmounts/remounts this whole overlay each time scanning is
                  re-entered, which restarts the CSS animation cleanly. */}
              <div className="qr-scan-line absolute left-0 right-0 h-0.5 bg-white/80" />
              {/* Helper text below the frame */}
              <p className="absolute -bottom-10 inset-x-0 px-2 text-center text-xs leading-snug text-white/80">
                {t.qrScanner.guideAim}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* "Enter code manually" footer (scanning phase) */}
      {phase === "scanning" && (
        <div className="bg-gradient-to-t from-black/95 to-black/70 px-4 pt-3 flex flex-col items-center gap-2 border-t border-white/10" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          {showFallbackHint && (
            <p className="text-white/60 text-xs text-center animate-fade-in">
              {t.qrScanner.fallbackHint}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-white hover:text-white hover:bg-white/20"
            onClick={() => {
              stopScanner();
              setPhase("manual");
            }}
            data-testid="btn-switch-manual"
          >
            <Keyboard className="w-4 h-4" />
            {t.qrScanner.manualEnterButton}
          </Button>
        </div>
      )}

      {/* Manual entry mode */}
      {phase === "manual" && (
        <div className="flex max-h-[100dvh] flex-1 flex-col items-center justify-center gap-5 overflow-y-auto overscroll-contain bg-black/95 p-6">
          <p className="text-center text-xl font-bold text-white">{t.qrScanner.manualEnterTitle}</p>
          <p className="max-w-md text-center text-sm text-white/65">
            {t.qrScanner.manualEnterDesc}
          </p>
          <Input
            className="w-full max-w-md min-w-0 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-primary"
            placeholder={t.qrScanner.manualInputPlaceholder}
            aria-label={t.qrScanner.manualInputPlaceholder}
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
            autoFocus
            data-testid="input-manual-code"
          />
          <div className="flex flex-col gap-2 w-full">
            <Button
              className="w-full"
              onClick={handleManualSubmit}
              disabled={!manualCode.trim()}
              data-testid="btn-manual-submit"
            >
              {t.qrScanner.search}
            </Button>
            <Button
              variant="outline"
              className="w-full text-white border-white/20 bg-white/5 hover:bg-white/10"
              onClick={() => {
                setManualCode("");
                startScanner();
              }}
              data-testid="btn-back-to-scan"
            >
              {t.qrScanner.backToCamera}
            </Button>
          </div>
        </div>
      )}

      <FirstScanCelebration
        open={phase === "first_scan_celebration" && pendingFirstScan}
        onContinue={() => {
          setPendingFirstScan(false);
          setPhase("result");
        }}
      />

      {/* Inline quick-action sheet — shown after successful QR resolve */}
      {phase === "result" && scannedEquipment && (
        <div className="flex-1 bg-black/95 flex flex-col justify-end" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div
            className="bg-card rounded-t-3xl px-5 pt-5 pb-6 mx-0 w-full motion-safe:animate-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-300"
            data-testid="scan-inline-sheet"
          >
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />
            <div
              className={cn(
                "mb-3 flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/50 px-3 py-2 text-xs font-semibold tabular-nums text-muted-foreground",
                scanCountPop && "motion-safe:[animation:scan-count-pop_320ms_ease-out]",
              )}
              data-testid="scan-daily-counter"
            >
              <span>{t.scanCelebration.scansToday}</span>
              <span className="text-base text-foreground">{(pulse?.scansToday ?? 0)}</span>
            </div>
            <div className="mb-4 rounded-2xl border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] px-3 py-3 vt-action-green">
              <div className="flex items-center gap-2 text-[var(--status-ok-fg)]">
                <div className="relative">
                  <CheckCircle2 className="h-5 w-5" />
                  <Sparkles className="h-3.5 w-3.5 absolute -right-1 -top-1 text-[hsl(var(--status-ok))]" />
                </div>
                <p className="text-sm font-semibold">{t.qrScanner.equipmentMatched}</p>
              </div>
            </div>

            {/* Equipment info */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg leading-tight truncate" dir="auto" data-testid="scan-inline-equipment-name">
                  {scannedEquipment.name}
                </p>
                {scannedEquipment.serialNumber && (
                  <p className="text-xs text-muted-foreground mt-0.5">#{scannedEquipment.serialNumber}</p>
                )}
                {scannedEquipment.location && (
                  <p className="text-xs text-muted-foreground">{scannedEquipment.location}</p>
                )}
                {scannedEquipment.usuallyFoundHere && (
                  <p className="mt-0.5 text-xs italic text-muted-foreground/70">{scannedEquipment.usuallyFoundHere}</p>
                )}
              </div>
              <Badge variant={statusToBadgeVariant(scannedEquipment.status)} className="shrink-0" data-testid="scan-inline-status-badge">
                {equipmentStatusLabel(scannedEquipment.status)}
              </Badge>
            </div>

            {/* Checkout info */}
            {isCheckedOut && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2.5 mb-4 text-sm">
                <p className="font-medium text-foreground">
                  {checkedOutByMe
                    ? t.qrScanner.checkedOutByYou
                    : t.qrScanner.inUseBy(scannedEquipment.checkedOutByEmail || t.common.unknown)}
                </p>
                {scannedEquipment.checkedOutLocation && (
                  <p className="text-primary text-xs mt-0.5">
                    {t.qrScanner.locationLabel(scannedEquipment.checkedOutLocation)}
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2.5">
              {/* Checkout / Return */}
              {!isCheckedOut && (
                <Button
                  size="lg"
                  className="w-full gap-2.5"
                  onClick={handleCheckout}
                  disabled={isActing}
                  data-testid="btn-scan-inline-checkout"
                >
                  {isActing ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
                  {t.qrScanner.checkOut}
                </Button>
              )}

              {isCheckedOut && (checkedOutByMe || isAdmin) && (
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full gap-2.5"
                  onClick={handleReturn}
                  disabled={isActing}
                  data-testid="btn-scan-inline-return"
                >
                  {isActing ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogOut className="w-5 h-5" />}
                  {t.qrScanner.returnEquipment}
                </Button>
              )}

              {isCheckedOut && !checkedOutByMe && !isAdmin && (
                <div className="rounded-xl border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] px-3 py-2.5 text-sm text-[var(--status-stale-fg)]">
                  {t.qrScanner.onlyOwnerCanReturn}
                </div>
              )}

              {/* Status quick-actions: Mark OK / Mark Issue */}
              <div className="flex min-w-0 gap-2">
                <Button
                  variant="outline"
                  size="default"
                  className="min-h-11 flex-1 gap-1.5 border-[var(--status-ok-border)] text-[var(--status-ok-fg)] hover:bg-[var(--status-ok-bg)]"
                  onClick={handleMarkOk}
                  disabled={isActing}
                  data-testid="btn-scan-inline-mark-ok"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {t.qrScanner.markOk}
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  className="min-h-11 flex-1 gap-1.5 border-[var(--status-issue-border)] text-[var(--status-issue-fg)] hover:bg-[var(--status-issue-bg)]"
                  onClick={handleMarkIssue}
                  disabled={isActing}
                  data-testid="btn-scan-inline-mark-issue"
                >
                  <Wrench className="w-4 h-4" />
                  {t.qrScanner.reportIssue}
                </Button>
              </div>

              <Button
                variant="ghost"
                className="w-full text-sm text-muted-foreground"
                onClick={() => navigateToEquipment(scannedEquipment.id)}
                data-testid="btn-scan-inline-details"
              >
                {t.qrScanner.viewFullDetails}
              </Button>
            </div>
          </div>
        </div>
      )}

      {scannedEquipment && (
        <ReturnPlugDialog
          open={returnDialogOpen}
          onOpenChange={setReturnDialogOpen}
          equipmentName={scannedEquipment.name}
          onConfirm={handleConfirmReturn}
          isSubmitting={isActing}
        />
      )}
    </div>,
    document.body,
  );
}
