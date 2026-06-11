import type { ReactNode } from "react";
import { ClerkFailed, ClerkLoaded, ClerkLoading } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { RouteFallback } from "@/components/route-fallback";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { t } from "@/lib/i18n";
import { safeReloadPage } from "@/lib/safe-browser";
import { Button } from "@/components/ui/button";

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
        <RouteFallback />
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
