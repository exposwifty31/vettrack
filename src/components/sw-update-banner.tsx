import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { isServiceWorkerSupported, safeReloadPage } from "@/lib/safe-browser";
import { isBoardPathname } from "@/app/platform";

/**
 * T-37 (R-SY-03 · CLICK-PATH-014) — deterministic Refresh reload policy.
 *
 * On the SW_UPDATED path the new worker may have ALREADY claimed the page by
 * the time the toast is shown (controllerchange already fired), so posting
 * SKIP_WAITING to an already-active worker is a no-op. Refresh instead
 * resolves via a single race:
 *   (a) target worker is already the controller  → reload immediately
 *   (b) else post SKIP_WAITING, reload on the next controllerchange
 *   (c) neither fires within this timeout        → fallback reload
 * An already-controller result or controllerchange wins over the timeout;
 * the reload runs exactly once (guard flag), and the timeout + listener are
 * always cleared once resolved (or on unmount).
 *
 * Every safeReloadPage() call in this file passes `minIntervalMs: 0`: the
 * global 5s reload-guard (shared sessionStorage key across the whole app)
 * exists to stop unrelated silent auto-reloads from stacking, not to
 * throttle this explicit, user-clicked "רענן" action. Without the bypass,
 * a reload from any other guarded path in the last 5s would make
 * safeReloadPage() return false here — reloadOnce() had already cleared its
 * own timeout/listener, so the stale bundle would stay loaded with no retry.
 */
const SW_UPDATE_RELOAD_TIMEOUT_MS = 3000;

type PendingReloadHandle = {
  cleanup: () => void;
};

/** Resolves the deterministic reload race described above for one worker. */
function scheduleDeterministicReload(worker: ServiceWorker): PendingReloadHandle {
  const noopHandle: PendingReloadHandle = { cleanup: () => {} };

  if (!isServiceWorkerSupported()) {
    safeReloadPage({ minIntervalMs: 0 });
    return noopHandle;
  }

  let container: ServiceWorkerContainer;
  try {
    container = navigator.serviceWorker;
  } catch {
    safeReloadPage({ minIntervalMs: 0 });
    return noopHandle;
  }

  // (a) The new worker has already claimed this page — reload immediately
  // instead of posting SKIP_WAITING to an already-active worker (a no-op).
  if (container.controller === worker) {
    safeReloadPage({ minIntervalMs: 0 });
    return noopHandle;
  }

  let didReload = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  function reloadOnce(): void {
    if (didReload) return;
    didReload = true;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try {
      container.removeEventListener("controllerchange", onControllerChange);
    } catch {
      // ignore — container is already gone
    }
    safeReloadPage({ minIntervalMs: 0 });
  }

  function onControllerChange(): void {
    reloadOnce();
  }

  // (c) Fallback — neither an already-current controller nor
  // controllerchange resolved the reload within the timeout window.
  timeoutId = setTimeout(reloadOnce, SW_UPDATE_RELOAD_TIMEOUT_MS);

  try {
    container.addEventListener("controllerchange", onControllerChange);
  } catch {
    // Listener registration failed — the timeout above still fires.
  }

  // (b) Ask the waiting worker to activate; controllerchange (or the
  // timeout fallback) drives the actual reload.
  try {
    worker.postMessage("SKIP_WAITING");
  } catch {
    // Posting failed — fall back to the timeout-driven reload.
  }

  return {
    cleanup: () => {
      if (didReload) return;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      try {
        container.removeEventListener("controllerchange", onControllerChange);
      } catch {
        // ignore — container is already gone
      }
    },
  };
}

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
  const pendingReloadRef = useRef<PendingReloadHandle | null>(null);

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
            if (!worker) {
              safeReloadPage({ minIntervalMs: 0 });
              return;
            }
            pendingReloadRef.current?.cleanup();
            pendingReloadRef.current = scheduleDeterministicReload(worker);
          },
        },
        icon: <RefreshCw className="w-4 h-4" />,
      });
    }

    window.addEventListener("sw-update-available", handleSwUpdate);
    return () => {
      window.removeEventListener("sw-update-available", handleSwUpdate);
      pendingReloadRef.current?.cleanup();
      pendingReloadRef.current = null;
    };
  }, [isBoard]);

  return null;
}
