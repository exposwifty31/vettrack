import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { VetTrackMark } from "@/components/vettrack-mark";
import { RoleChips, type SignupRequestedRole } from "@/features/auth/components/RoleChips";
import { readCarriedRole, writeCarriedRole } from "@/features/auth/requested-role-store";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, useUser } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/use-auth";
import { isClerkEnabled } from "@/lib/auth-fetch";
import { PhoneSignIn } from "@/components/phone-sign-in";
import { getClerkAppearance, getClerkAppearanceNative } from "@/lib/clerk-appearance";
import { useIsDarkActive } from "@/hooks/use-settings";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { ClerkAuthFormShell } from "@/components/clerk-auth-form-shell";
import { AuthBootstrapSpinner } from "@/components/native-clerk-gate";
import { NativeSocialButtons } from "@/components/native-social-buttons";
import { OfflineAuthGate } from "@/components/offline-auth-gate";
import { LegalFooterLinks } from "@/components/legal-footer-links";

const CLERK_ENABLED = isClerkEnabled();

/**
 * Clerk-mode-only bootstrap gate. `useUser` is valid ONLY under a mounted
 * ClerkProvider (Clerk's rule — "useUser can only be used within <ClerkProvider>"),
 * so this — the sign-in page's only `useUser` caller — renders exclusively when
 * `CLERK_ENABLED`; in dev-bypass the provider isn't mounted and calling `useUser`
 * would crash. While a Clerk session exists but VetTrack hasn't confirmed sign-in,
 * show the bootstrap spinner (do NOT mount <SignIn> — it auto-redirects to /home and
 * races AuthGuard into a /home ↔ /signin loop). Otherwise render the page.
 */
function ClerkSignInBootstrapGate({
  vtSignedIn,
  children,
}: {
  vtSignedIn: boolean;
  children: ReactNode;
}) {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useUser();
  if (clerkLoaded && clerkSignedIn && !vtSignedIn) {
    return (
      <>
        <Helmet>
          <title>{t.authPage.signInMetaTitle}</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <AuthBootstrapSpinner />
      </>
    );
  }
  return <>{children}</>;
}

export default function SignInPage() {
  const isNative = isCapacitorNative();
  const { isLoaded, isSignedIn } = useAuth();
  const [, navigate] = useLocation();
  const [usePhoneFlow, setUsePhoneFlow] = useState(false);
  // C5: pre-choosing a role here carries it to the sign-up screen.
  const [preRole, setPreRole] = useState<SignupRequestedRole | null>(() => readCarriedRole());
  const isDark = useIsDarkActive();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate("/home");
    }
  }, [isLoaded, isSignedIn, navigate]);

  const page = (
    <>
      <Helmet>
        <title>{t.authPage.signInMetaTitle}</title>
        <meta name="description" content={t.authPage.signInMetaDescription} />
        <link rel="canonical" href="https://vettrack.replit.app/signin" />
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-[100dvh] bg-gradient-to-b from-primary/5 to-background flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 mb-6 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <VetTrackMark size={40} />
              <span className="text-2xl font-bold text-foreground">VetTrack</span>
            </Link>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t.authPage.welcomeBack}</h1>
            <p className="text-sm text-muted-foreground">{t.authPage.signInSubtitle}</p>
          </div>

          <RoleChips
            selectedRole={preRole}
            onSelectRole={(role) => {
              setPreRole(role);
              writeCarriedRole(role);
            }}
          />

          {CLERK_ENABLED ? (
            <div className="flex flex-col items-center gap-4">
              {usePhoneFlow ? (
                <>
                  <OfflineAuthGate>
                    <PhoneSignIn />
                  </OfflineAuthGate>
                  <button
                    type="button"
                    onClick={() => setUsePhoneFlow(false)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    → {t.authPage.backToRegularSignIn}
                  </button>
                </>
              ) : (
                <>
                  <ClerkLoading>
                    <div className="flex w-full min-h-[12rem] justify-center items-center" aria-busy>
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  </ClerkLoading>
                  <ClerkFailed>
                    <p className="text-sm text-center text-destructive px-2" role="alert">
                      {t.authPage.signInLoadError}
                    </p>
                  </ClerkFailed>
                  <ClerkLoaded>
                    <ClerkAuthFormShell>
                      <OfflineAuthGate>
                        <div className="w-full min-h-[24rem] flex flex-col items-center justify-start gap-4">
                          {isNative ? <NativeSocialButtons mode="signIn" /> : null}
                          <SignIn
                            routing="hash"
                            signUpUrl="/signup"
                            fallbackRedirectUrl="/home"
                            appearance={isNative ? getClerkAppearanceNative(isDark) : getClerkAppearance(isDark)}
                          />
                        </div>
                      </OfflineAuthGate>
                    </ClerkAuthFormShell>
                  </ClerkLoaded>
                  <p className="text-xs text-muted-foreground text-center max-w-xs">
                    {t.authPage.phonePrompt}{" "}
                    <button
                      type="button"
                      onClick={() => setUsePhoneFlow(true)}
                      className="underline hover:text-primary transition-colors"
                    >
                      {t.authPage.usePhoneSignIn}
                    </button>{" "}
                    {t.authPage.phoneFormatHint}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm text-center">
              <p className="text-sm text-muted-foreground mb-4">
                {t.authPage.devModeNotice}
              </p>
              <Link
                href="/home"
                className="inline-flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-4 py-3 rounded-xl transition-colors"
              >
                {t.authPage.enterDashboard}
              </Link>
            </div>
          )}

          <div className="text-center mt-6 space-y-3">
            <LegalFooterLinks />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              → {t.authPage.moreAboutVetTrack}
            </Link>
          </div>
        </div>
      </div>
    </>
  );

  return CLERK_ENABLED ? (
    <ClerkSignInBootstrapGate vtSignedIn={isSignedIn}>{page}</ClerkSignInBootstrapGate>
  ) : (
    page
  );
}
