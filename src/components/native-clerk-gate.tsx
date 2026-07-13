import { useEffect, useState, type ReactNode } from "react";
import { ClerkFailed, ClerkLoaded, ClerkLoading } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { RouteFallback } from "@/components/route-fallback";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { t } from "@/lib/i18n";
import { isOnline, safeReloadPage } from "@/lib/safe-browser";
import { Button } from "@/components/ui/button";

/**
 * How long to wait for clerk-js to resolve before treating a persistent
 * `ClerkLoading` as an offline/unreachable state (in addition to the immediate
 * `navigator.onLine === false` check). Clerk never fires `ClerkFailed` when the
 * device is offline, so without this the native shell spins forever (T-12).
 */
const CLERK_LOAD_TIMEOUT_MS = 8000;

/**
 * Rendered inside `<ClerkLoading>`: shows the loading skeleton while genuinely
 * loading online, but flips to a "connect to sign in" prompt when the device is
 * offline (immediately, on the `offline` event, or after a load timeout), and
 * auto-reloads to retry when connectivity returns.
 */
function ClerkLoadingContent() {
  const [offline, setOffline] = useState(() => !isOnline());

  useEffect(() => {
    if (!isOnline()) {
      setOffline(true);
      // Still register the online listener below so we auto-retry on reconnect.
    }
    const timer = setTimeout(() => {
      if (!isOnline()) setOffline(true);
    }, CLERK_LOAD_TIMEOUT_MS);
    const handleOffline = () => setOffline(true);
    const handleOnline = () => safeReloadPage();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!offline) {
    return <RouteFallback />;
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 text-center bg-background"
      data-testid="clerk-offline-gate"
    >
      <p className="text-base font-semibold text-foreground">{t.auth.guard.offlineTitle}</p>
      <p className="text-sm text-muted-foreground max-w-md">{t.auth.guard.offlineBody}</p>
      <Button type="button" variant="outline" onClick={() => safeReloadPage()}>
        {t.auth.guard.offlineRetry}
      </Button>
    </div>
  );
}

/**
 * On Capacitor iOS the bundled shell origin is `capacitor://localhost`. Clerk must finish
 * loading clerk-js before hooks like `useUser` resolve; until then many routes render
 * `null` and the WebView looks blank. This gate shows loading / failure UI at the shell.
 */
export function NativeClerkGate({ children }: { children: ReactNode }) {
  if (!isCapacitorNative()) {
    return <>{children}</>;
  }

  return (
    <>
      <ClerkLoading>
        <ClerkLoadingContent />
      </ClerkLoading>
      <ClerkFailed>
        <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 text-center bg-background">
          <p className="text-sm text-destructive max-w-md" role="alert">
            {t.auth.guard.nativeClerkFailed}
          </p>
          <Button type="button" variant="outline" onClick={() => safeReloadPage()}>
            {t.errorCard.refreshPage}
          </Button>
        </div>
      </ClerkFailed>
      <ClerkLoaded>{children}</ClerkLoaded>
    </>
  );
}

/** Compact inline spinner for route-level auth waits (non-shell). */
export function AuthBootstrapSpinner() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background" role="status" aria-busy>
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
    </div>
  );
}
