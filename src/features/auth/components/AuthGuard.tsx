import { useEffect, useState, type ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { Loader2, ShieldAlert, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type AccessDeniedReason, useAuth } from "@/hooks/use-auth";
import { markNfcSignInToastShown, wasNfcSignInToastShownRecently } from "@/lib/nfc-equipment-toggle";
import { t } from "@/lib/i18n";

/**
 * Agent-friendly diagnostics shown only on prolonged load timeout in dev.
 * Keeps production UX unchanged (text stays the same there).
 */
function buildDevTimeoutDiagnostics(): string[] {
  const envMode = (typeof import.meta !== "undefined" && import.meta.env?.MODE) || "unknown";
  const pub = (typeof import.meta !== "undefined" && import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY) || "";
  const clientMode = pub ? "clerk" : "dev-bypass";
  return [
    `mode=${clientMode} env=${envMode}`,
    "Likely causes: API server down, wrong DATABASE_URL, pending user, or Clerk/server mode mismatch.",
    "Try: pnpm run auth:preflight (env + mode + API reachability).",
  ];
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { isLoaded, isSignedIn, status, accessDeniedReason, signOut, refreshAuth } = useAuth();

  const accessDeniedReasonText: Record<Exclude<AccessDeniedReason, null>, string> = {
    MISSING_CLINIC_ID: t.auth.guard.reasons.missingClinicId,
    DB_FALLBACK_DISABLED: t.auth.guard.reasons.dbFallbackDisabled,
    TENANT_CONTEXT_MISSING: t.auth.guard.reasons.missingClinicContext,
    TENANT_MISMATCH: t.auth.guard.reasons.tenantMismatch,
    INSUFFICIENT_ROLE: t.auth.guard.reasons.insufficientRole,
    ACCOUNT_DELETED: t.auth.guard.reasons.accountDeleted,
    ACCOUNT_BLOCKED: t.auth.guard.reasons.accountBlocked,
    ACCOUNT_PENDING_APPROVAL: t.auth.guard.reasons.accountPendingApproval,
  };

  useEffect(() => {
    if (isLoaded) {
      setLoadTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoadTimedOut(true);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [isLoaded]);

  // Logged-out NFC scan (B1): the deep-link router always navigates to
  // /equipment/<id>?nfcAction=toggle&nfcTs=…; once auth resolves to logged-out we explain why the
  // tap did nothing. The toast MUST live in an effect (not the render body) — calling toast.* during
  // render mutates sonner's Toaster store mid-render of a different component (React warning + illegal
  // render-phase side effect). The render-phase <Redirect to="/signin"/> below stays unchanged.
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    if (new URLSearchParams(search).get("nfcAction") !== "toggle") return;
    if (wasNfcSignInToastShownRecently()) return; // D6: 8s window, RE-ARMS
    markNfcSignInToastShown();
    toast.dismiss("nfc-open");
    toast.error(t.nfcEntry.signInFirst);
  }, [isLoaded, isSignedIn, search]);

  if (!isLoaded) {
    const isNfcEntry = new URLSearchParams(search).get("nfcAction") === "toggle";
    if (!loadTimedOut) {
      return (
        <div
          className="flex h-screen flex-col items-center justify-center gap-3"
          role="status"
          aria-label={isNfcEntry ? t.nfcEntry.openingEquipment : t.common.loading}
        >
          <Loader2 className="animate-spin" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {isNfcEntry ? t.nfcEntry.openingEquipment : t.common.loading}
          </p>
        </div>
      );
    }
    const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
    const diagnostics = isDev ? buildDevTimeoutDiagnostics() : null;
    return (
      <div className="flex h-screen flex-col items-center justify-center text-center p-6">
        <ShieldAlert className="h-16 w-16 text-amber-500 mb-4" />
        <h1 className="text-2xl font-bold">{t.auth.guard.loadingApp}</h1>
        <p>{t.api.networkUnavailable}</p>
        {diagnostics ? (
          <pre
            className="mt-3 max-w-xl whitespace-pre-wrap rounded border border-dashed border-amber-400 bg-amber-50 p-3 text-left text-xs text-amber-900"
            data-testid="auth-guard-dev-diagnostics"
          >
            {diagnostics.join("\n")}
          </pre>
        ) : null}
        <div className="mt-4 flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setLoadTimedOut(false);
              refreshAuth();
            }}
          >
            {t.auth.guard.retry}
          </Button>
        </div>
      </div>
    );
  }

  if (!isSignedIn) return <Redirect to="/signin" />;

  if (status === "pending") return (
    <div className="flex h-screen flex-col items-center justify-center text-center p-6">
      <Clock className="h-16 w-16 text-amber-500 mb-4" />
      <h1 className="text-2xl font-bold">{t.auth.guard.pendingTitle}</h1>
      <Button className="mt-4" onClick={signOut}>{t.auth.guard.signOut}</Button>
    </div>
  );

  if (status === "blocked") return (
    <div className="flex h-screen flex-col items-center justify-center text-center p-6 bg-destructive/5">
      <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
      <h1 className="text-2xl font-bold text-destructive">{t.auth.guard.blockedTitle}</h1>
      <p>{t.auth.guard.blockedDescription}</p>
      <Button className="mt-4" onClick={signOut}>{t.auth.guard.signOut}</Button>
    </div>
  );

  if (accessDeniedReason) {
    return (
      <div className="flex h-screen flex-col items-center justify-center text-center p-6 bg-destructive/5">
        <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-destructive">{t.auth.guard.accessDeniedTitle}</h1>
        <p>{accessDeniedReasonText[accessDeniedReason] ?? t.auth.guard.accessDeniedDescription}</p>
        <div className="mt-4 flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setLoadTimedOut(false);
              refreshAuth();
              if (location === "/signin") {
                navigate("/", { replace: true });
              }
            }}
          >
            {t.auth.guard.retry}
          </Button>
          <Button onClick={signOut}>{t.auth.guard.signOut}</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
