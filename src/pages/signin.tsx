import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { RoleChips, type SignupRequestedRole } from "@/features/auth/components/RoleChips";
import { AuthDoorChrome } from "@/features/auth/components/AuthDoorChrome";
import { readCarriedRole, writeCarriedRole } from "@/features/auth/requested-role-store";
import { captureJoinCodeFromSearch } from "@/features/auth/join-code-store";
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

  // Invite link `?clinic=CODE` may land on /signin too (shared links, redirects) —
  // stash the join code for the post-auth JoinClinicScreen (join-code-store).
  useEffect(() => {
    captureJoinCodeFromSearch(window.location.search);
  }, []);

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
        <link rel="canonical" href="https://vettrack.uk/signin" />
        <meta name="robots" content="noindex" />
      </Helmet>

      <AuthDoorChrome
        title={t.authPage.welcomeBack}
        subtitle={t.authPage.signInSubtitle}
        footer={<LegalFooterLinks />}
      >
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
                  className="vt-text-xs text-ivory-text3 hover:text-primary transition-colors underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  <p className="vt-text-sm text-center text-destructive px-2" role="alert">
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
                <p className="vt-text-xs text-ivory-text3 text-center max-w-xs text-pretty">
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
          <div className="rounded-md border border-ivory-border bg-ivory-bg/60 p-5 text-center">
            <p className="vt-text-sm text-ivory-text2 mb-4">{t.authPage.devModeNotice}</p>
            <Link
              href="/home"
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t.authPage.enterDashboard}
            </Link>
          </div>
        )}
      </AuthDoorChrome>
    </>
  );

  return CLERK_ENABLED ? (
    <ClerkSignInBootstrapGate vtSignedIn={isSignedIn}>{page}</ClerkSignInBootstrapGate>
  ) : (
    page
  );
}
