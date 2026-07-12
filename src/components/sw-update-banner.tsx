import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { isServiceWorkerSupported, safeReloadPage } from "@/lib/safe-browser";
import { isBoardPathname } from "@/app/platform";

/**
 * The /board wall kiosk has its own Code-Blue-aware reload owner
 * (useBoardAutoReload) — an un-gated click-to-refresh toast on an unattended
 * wall display would just sit there forever (nobody taps it) while also being
 * a second, non-Code-Blue-aware surface for the same event. So this banner is
 * a no-op on board/kiosk paths; useBoardAutoReload stays the sole reload owner
 * there. Non-board surfaces (normal staff devices) are unaffected.
 *
 * This banner mounts ONCE at the app root (src/main.tsx), so the board-path
 * check must be reactive to same-tab SPA navigation (e.g. the
 * /equipment/board, /display, /equipment-board client-side redirects land on
 * /board without a full page reload). isBoardPathname is read via wouter's
 * useLocation() — same reactive pattern as usePlatformTarget — so the
 * suppression re-evaluates on every navigation instead of only at mount.
 */
export function SwUpdateBanner() {
  const [pathname] = useLocation();
  const isBoard = isBoardPathname(pathname);
  const workerRef = useRef<ServiceWorker | null>(null);
  const toastShownRef = useRef(false);

  useEffect(() => {
    if (isBoard) return;
    function handleSwUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ worker: ServiceWorker }>;
      workerRef.current = customEvent.detail.worker;

      if (toastShownRef.current) return;
      toastShownRef.current = true;

      toast(t.swUpdate.updateAvailable, {
        duration: Infinity,
        action: {
          label: "רענן",
          onClick: () => {
            const worker = workerRef.current;
            if (worker) {
              worker.postMessage("SKIP_WAITING");
              if (isServiceWorkerSupported()) {
                try {
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => {
                      safeReloadPage({ minIntervalMs: 3000 });
                    },
                    { once: true },
                  );
                } catch {
                  safeReloadPage({ minIntervalMs: 3000 });
                }
              } else {
                safeReloadPage({ minIntervalMs: 3000 });
              }
            } else {
              safeReloadPage({ minIntervalMs: 3000 });
            }
          },
        },
        icon: <RefreshCw className="w-4 h-4" />,
      });
    }

    window.addEventListener("sw-update-available", handleSwUpdate);
    return () => window.removeEventListener("sw-update-available", handleSwUpdate);
  }, [isBoard]);

  return null;
}
