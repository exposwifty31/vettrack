import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import App from "./App";
import "./index.css";
import "./instrument";

import { ClerkAuthProviderInner } from "@/hooks/use-auth";
import { SyncProvider } from "@/hooks/use-sync";
import { SettingsProvider } from "@/hooks/use-settings";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "sonner";
import { HelmetProvider } from "react-helmet-async";
import { AppErrorBoundary } from "@/components/ui/app-error-boundary";
import { SyncStatusBanner } from "@/components/sync-status-banner";
import { SwUpdateBanner } from "@/components/sw-update-banner";
import { ShiftChatFab } from "@/features/shift-chat/components/ShiftChatFab";
import {
  chunkLoadErrorFromReason,
  recoverFromChunkLoadFailure,
} from "@/lib/chunk-load-recovery";
import {
  getServiceWorkerRegistrationsSafe,
  isServiceWorkerSupported,
  registerServiceWorkerSafe,
} from "@/lib/safe-browser";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { clerkProviderPropsForRuntime } from "@/lib/clerk-capacitor-config";
import { NativeClerkGate } from "@/components/native-clerk-gate";
import { primeNfcSupportCache } from "@/lib/nfc-platform";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const CLERK_ENABLED = Boolean(PUBLISHABLE_KEY);

// Local auth mode contract (deterministic):
//   VITE_CLERK_PUBLISHABLE_KEY present => Clerk mode
//   Missing publishable key           => dev bypass mode
// Emits a single, secret-free startup line so operators and agents can confirm
// which mode the browser is about to run in before hitting the UI.
if (import.meta.env.DEV || isCapacitorNative()) {
  const rawKey = typeof PUBLISHABLE_KEY === "string" ? PUBLISHABLE_KEY.trim() : "";
  const keyPrefix = rawKey ? rawKey.slice(0, 7) : "(none)";
  const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim() || "(same-origin)";
  // eslint-disable-next-line no-console
  console.info(
    `[auth-mode] client=${CLERK_ENABLED ? "clerk" : "dev-bypass"} publishableKey=${keyPrefix} apiOrigin=${apiOrigin} env=${import.meta.env.MODE}`,
  );
}

const rootEl = document.getElementById("root");

function AppBootstrap() {
  const [localeVersion, setLocaleVersion] = useState(0);
  useEffect(() => {
    if (import.meta.env.PROD) {
      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        const msg = chunkLoadErrorFromReason(event.reason);
        if (!msg) return;
        event.preventDefault();
        void recoverFromChunkLoadFailure({ unregisterServiceWorkers: true });
      };
      const onWindowError = (event: ErrorEvent) => {
        if (!event.message) return;
        const msg = chunkLoadErrorFromReason(event.message);
        if (!msg) return;
        void recoverFromChunkLoadFailure({ unregisterServiceWorkers: true });
      };
      window.addEventListener("unhandledrejection", onUnhandledRejection);
      window.addEventListener("error", onWindowError);
      return () => {
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
        window.removeEventListener("error", onWindowError);
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (isCapacitorNative()) {
      void primeNfcSupportCache().catch(() => {
        // NFC probe is best-effort; QR/manual entry remains available.
      });
      return;
    }
    if (!isServiceWorkerSupported()) return;
    if (import.meta.env.DEV) {
      // In dev, unregister any cached SW so Vite HMR is never intercepted.
      getServiceWorkerRegistrationsSafe().then((regs) => {
        regs.forEach((r) => {
          r.unregister().catch(() => {});
        });
      });
      return;
    }
    // Phase 9 PR 9.1 — single source-of-truth build tag.
    // The same value is injected into the SW at build time by the
    // swBuildTagTemplate Vite plugin, so SW_UPDATED can carry buildTag and
    // the client can compare against the bundle's own tag.
    const BUILD_TAG = __VT_BUILD_TAG__;
    registerServiceWorkerSafe(`/sw.js?v=${encodeURIComponent(BUILD_TAG)}`, { updateViaCache: "none" })
      .then((registration) => {
        if (!registration) {
          console.warn("VetTrack: service worker registration unavailable.");
          return;
        }

        // Wire SW_UPDATED messages from the service worker to the window event
        // that SwUpdateBanner listens for. Only surface the banner when the
        // SW's build tag differs from the loaded bundle's build tag — repeated
        // SW_UPDATED for the same tag is a no-op (anti-toast-spam).
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data?.type !== "SW_UPDATED") return;
          const swBuildTag = typeof event.data.buildTag === "string" ? event.data.buildTag : null;
          if (swBuildTag && swBuildTag === BUILD_TAG) return;
          window.dispatchEvent(
            new CustomEvent("sw-update-available", {
              detail: { worker: registration.active, buildTag: swBuildTag },
            })
          );
        });

        // Also handle the waiting worker case: if a new SW is already waiting
        // when the page loads (e.g. the user had an old tab open), surface the
        // update banner immediately — but only when the waiting SW's build tag
        // differs from the loaded bundle (same guard as SW_UPDATED above).
        function notifyIfWaiting(reg: ServiceWorkerRegistration) {
          if (!reg.waiting) return;
          try {
            const waitingTag = new URL(reg.waiting.scriptURL).searchParams.get("v");
            if (waitingTag && waitingTag === BUILD_TAG) return;
          } catch {
            // scriptURL parse failure — fall through and show banner
          }
          window.dispatchEvent(
            new CustomEvent("sw-update-available", {
              detail: { worker: reg.waiting, buildTag: null },
            })
          );
        }

        notifyIfWaiting(registration);

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed") {
              notifyIfWaiting(registration);
            }
          });
        });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const handler = () => setLocaleVersion((v) => v + 1);
    window.addEventListener("vettrack:locale-changed", handler as EventListener);
    return () => window.removeEventListener("vettrack:locale-changed", handler as EventListener);
  }, []);

  return <App key={`locale-${localeVersion}`} />;
}

if (!rootEl) {
  console.error("VetTrack: #root element not found — cannot mount app.");
} else {
  const appShell = (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ClerkAuthProviderInner>
          <AppErrorBoundary>
            <SyncProvider>
              <AppBootstrap />
              <SwUpdateBanner />
              <SyncStatusBanner />
              <ShiftChatFab />
              <Toaster
                position="top-center"
                richColors
                closeButton
                duration={3800}
                toastOptions={{
                  classNames: {
                    toast:
                      "group rounded-2xl border border-border/70 bg-background/95 shadow-lg backdrop-blur-md",
                    title: "font-semibold text-foreground",
                    description: "text-muted-foreground text-sm",
                    success: "border-emerald-200/90 dark:border-emerald-900/80",
                    error: "border-destructive/35",
                    warning: "border-amber-200/90 dark:border-amber-900/70",
                    info: "border-primary/25",
                  },
                }}
              />
            </SyncProvider>
          </AppErrorBoundary>
        </ClerkAuthProviderInner>
      </SettingsProvider>
    </QueryClientProvider>
  );

  const clerkRuntime = CLERK_ENABLED ? clerkProviderPropsForRuntime(PUBLISHABLE_KEY) : null;

  createRoot(rootEl).render(
    <HelmetProvider>
      {clerkRuntime ? (
        <ClerkProvider
          publishableKey={clerkRuntime.publishableKey}
          allowedRedirectOrigins={clerkRuntime.allowedRedirectOrigins}
        >
          <NativeClerkGate>{appShell}</NativeClerkGate>
        </ClerkProvider>
      ) : (
        appShell
      )}
    </HelmetProvider>
  );
}
