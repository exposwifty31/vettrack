import { useEffect, useRef, useState, type ReactNode } from "react";
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
  // The `online` listener is bound once; read the latest `offline` via a ref so
  // it can tell a real recovery from a spurious event without a stale closure.
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  // Recover from a genuine offline period: reload to remount clerk-js fresh. The
  // shared reload is throttled session-wide, so if it no-ops just drop the gate —
  // never strand the user on "tap to retry".
  const recover = () => {
    if (!safeReloadPage()) setOffline(false);
  };

  useEffect(() => {
    // Re-sync in case connectivity changed between the initializer and mount.
    setOffline(!isOnline());
    const handleOffline = () => setOffline(true);
    // Ignore spurious `online` events fired while we were never showing the gate
    // (Capacitor app-resume / interface flapping) — reloading then would discard
    // the user's in-progress sign-in form. Only recover from a real offline state.
    const handleOnline = () => {
      if (offlineRef.current) recover();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!offline) {
    return <>{children}</>;
  }

  return (
    <div
      className="w-full flex flex-col items-center justify-center gap-4 py-12 px-2 text-center"
      data-testid="offline-auth-gate"
    >
      <p className="text-base font-semibold text-foreground">{t.auth.guard.offlineTitle}</p>
      <p className="text-sm text-muted-foreground max-w-md">{t.auth.guard.offlineBody}</p>
      <Button type="button" variant="outline" onClick={recover}>
        {t.auth.guard.offlineRetry}
      </Button>
    </div>
  );
}
