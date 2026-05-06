import { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { isServiceWorkerSupported, safeReloadPage } from "@/lib/safe-browser";

export function SwUpdateBanner() {
  const workerRef = useRef<ServiceWorker | null>(null);
  const toastShownRef = useRef(false);

  useEffect(() => {
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
  }, []);

  return null;
}
