import { createRoot, type Root } from "react-dom/client";
import { ClerkProvider, type ClerkProp } from "@clerk/clerk-react";
import { useEffect, useState, type ReactNode } from "react";
import App from "./App";
import "./index.css";
import "./instrument";

import { ClerkAuthProviderInner } from "@/hooks/use-auth";
import { SyncProvider } from "@/hooks/use-sync";
import { SettingsProvider } from "@/hooks/use-settings";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "sonner";
import { HelmetProvider } from "react-helmet-async";
import { AppErrorBoundary } from "@/components/ui/app-error-boundary";
import { SyncStatusBanner } from "@/components/sync-status-banner";
import { GlobalSyncQueue } from "@/components/global-sync-queue";
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
import {
  clerkLocalizationForLocale,
  clerkProviderPropsForRuntime,
  type ClerkProviderRuntimeProps,
} from "@/lib/clerk-capacitor-config";
import { getCurrentLocale, type Locale } from "@/lib/i18n";
import { NativeClerkGate } from "@/components/native-clerk-gate";
import { primeNfcSupportCache } from "@/lib/nfc-platform";
import { usePlatformTarget } from "@/app/platform";

/**
 * The global chat float is for the DESKTOP / marketing web shells only. Every
 * mobile shell (phone + iPad, native or installed PWA) renders NativeHeader, which
 * owns the single useShiftChat instance via its header launcher — so mounting the
 * float on mobile too would double-subscribe. The board kiosk (/board) is
 * chrome-free: it must show no FAB. GlobalShiftChat is a root sibling of the
 * router, so BoardShell cannot suppress it — the gate lives here.
 */
function GlobalShiftChat() {
  const target = usePlatformTarget();
  return target === "mobile" || target === "board" ? null : <ShiftChatFab />;
}

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

/** Persist across Vite HMR so we never call createRoot twice on #root. */
declare global {
  interface Window {
    __VT_REACT_ROOT__?: Root;
  }
}

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
      // Universal Link / Control / quick-action deep links converge here. Dynamic import keeps
      // the router (and its @capacitor/app dep) out of the web bundle.
      void import("@/lib/deep-link-router").then((m) => m.initDeepLinkRouter());
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

/**
 * Wraps ClerkProvider so the Clerk sign-in card's locale tracks the app's
 * current locale live, not just at boot (T8 — the card previously always
 * rendered in English regardless of the surrounding Hebrew chrome).
 * Re-derives on the same "vettrack:locale-changed" event AppBootstrap
 * already listens to, so a mid-session locale switch updates the card
 * without a full reload. `runtimeProps.localization` (from
 * `clerkProviderPropsForRuntime`) is the boot-time snapshot; this overrides
 * it on every render with the live value.
 */
function ClerkLocaleBridge({
  runtimeProps,
  nativeClerk,
  children,
}: {
  runtimeProps: ClerkProviderRuntimeProps;
  nativeClerk?: ClerkProp;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(() => getCurrentLocale());
  useEffect(() => {
    const handler = () => setLocale(getCurrentLocale());
    window.addEventListener("vettrack:locale-changed", handler);
    return () => window.removeEventListener("vettrack:locale-changed", handler);
  }, []);
  return (
    <ClerkProvider {...runtimeProps} localization={clerkLocalizationForLocale(locale)} Clerk={nativeClerk}>
      {children}
    </ClerkProvider>
  );
}

if (!rootEl) {
  console.error("VetTrack: #root element not found — cannot mount app.");
} else {
  const appShell = (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ConfirmProvider>
          <ClerkAuthProviderInner>
            <AppErrorBoundary>
              <SyncProvider>
              <AppBootstrap />
              <SwUpdateBanner />
              <SyncStatusBanner />
              <GlobalSyncQueue />
              <GlobalShiftChat />
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
        </ConfirmProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );

  const clerkRuntime = CLERK_ENABLED ? clerkProviderPropsForRuntime(PUBLISHABLE_KEY) : null;

  // The bundled Capacitor shell needs a self-constructed clerk-js instance with
  // native request transport (_is_native=1 + Authorization header) — cookie-based
  // hot-loaded clerk-js cannot complete system-browser OAuth on a production
  // instance (see src/lib/clerk-native-instance.ts). Loaded dynamically so the
  // web bundle never ships clerk-js.
  const nativeClerkPromise: Promise<ClerkProp> =
    clerkRuntime && isCapacitorNative()
      ? import("@/lib/clerk-native-instance")
          .then((m) => m.createNativeClerkInstance(PUBLISHABLE_KEY) as unknown as ClerkProp)
          .catch((err) => {
            // Boot must never dead-end on a failed chunk: fall back to the
            // hot-loaded clerk-js (cookie mode). System-browser OAuth won't
            // work in that degraded state, but the app renders and email/
            // password still does — and NativeClerkGate surfaces load errors.
            console.error("[native-clerk] failed to construct native instance; falling back", err);
            return undefined;
          })
      : Promise.resolve(undefined);

  const renderApp = (nativeClerk?: ClerkProp) => {
    let root = window.__VT_REACT_ROOT__;
    if (!root) {
      root = createRoot(rootEl);
      window.__VT_REACT_ROOT__ = root;
    }
    root.render(
      <HelmetProvider>
        {clerkRuntime ? (
          <ClerkLocaleBridge runtimeProps={clerkRuntime} nativeClerk={nativeClerk}>
            <NativeClerkGate>{appShell}</NativeClerkGate>
          </ClerkLocaleBridge>
        ) : (
          appShell
        )}
      </HelmetProvider>,
    );
  };

  void nativeClerkPromise.then((nativeClerk) => {
    renderApp(nativeClerk);
  });

  if (import.meta.hot) {
    import.meta.hot.accept(() => {
      void nativeClerkPromise.then((nativeClerk) => {
        renderApp(nativeClerk);
      });
    });
  }
}
