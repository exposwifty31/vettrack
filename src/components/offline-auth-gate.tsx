import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { isOnline, safeReloadPage } from "@/lib/safe-browser";
import { Button } from "@/components/ui/button";

/**
 * Wraps a Clerk auth form (`<SignIn>` / `<SignUp>`) on the sign-in/sign-up pages.
 *
 * While the device is offline it renders the graceful "connect to sign in"
 * prompt INSTEAD of its children, so clerk-js never mounts and therefore never
 * fires its own "No Internet Connection" toast over a blank form (real-device
 * finding). It auto-reloads to retry when connectivity returns.
 *
 * This complements `NativeClerkGate`, which covers the earlier
 * still-`ClerkLoading` path; this gate covers the case where clerk-js was
 * already cached, so the shell reached `ClerkLoaded` and the auth form mounted.
 */
export function OfflineAuthGate({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(() => !isOnline());
  // Read the latest `offline` inside the once-bound `online` listener without a
  // stale closure, so it can tell a real recovery from a spurious event.
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  // Reload to pick up the freshly-online clerk-js. `safeReloadPage()` can refuse
  // (its 5s guard returns false) — in that case, don't leave the user stranded
  // on the offline screen: re-sync the block from live connectivity instead.
  const retryConnection = useCallback(() => {
    if (!safeReloadPage()) {
      setOffline(!isOnline());
    }
  }, []);

  useEffect(() => {
    // Re-sync in case connectivity changed between the initializer and mount.
    setOffline(!isOnline());
    const handleOffline = () => {
      // Update the ref eagerly (not just on the next render) so a rapid
      // offline→online sequence still sees `true` in handleOnline and recovers.
      offlineRef.current = true;
      setOffline(true);
    };
    // Only recover on `online` if the gate was actually showing. Browsers/WebViews
    // (Capacitor app-resume, interface flapping) fire spurious `online` events while
    // already online — reloading then would discard the user's in-progress form.
    const handleOnline = () => {
      if (offlineRef.current) retryConnection();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [retryConnection]);

  if (!offline) {
    return <>{children}</>;
  }

  return (
    <div
      className="w-full flex flex-col items-center justify-center gap-4 py-12 px-2 text-center"
      data-testid="offline-auth-gate"
      role="status"
      aria-live="polite"
    >
      <p className="text-base font-semibold text-foreground">{t.auth.guard.offlineTitle}</p>
      <p className="text-sm text-muted-foreground max-w-md">{t.auth.guard.offlineBody}</p>
      <Button type="button" variant="outline" onClick={retryConnection}>
        {t.auth.guard.offlineRetry}
      </Button>
    </div>
  );
}
