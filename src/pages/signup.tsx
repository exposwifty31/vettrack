import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { RoleChips, type SignupRequestedRole } from "@/features/auth/components/RoleChips";
import { AuthDoorChrome } from "@/features/auth/components/AuthDoorChrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { captureJoinCodeFromSearch } from "@/features/auth/join-code-store";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/use-auth";
import { isClerkEnabled } from "@/lib/auth-fetch";
import { getClerkAppearance, getClerkAppearanceNative } from "@/lib/clerk-appearance";
import { useIsDarkActive } from "@/hooks/use-settings";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { ClerkAuthFormShell } from "@/components/clerk-auth-form-shell";
import { NativeSocialButtons } from "@/components/native-social-buttons";
import { OfflineAuthGate } from "@/components/offline-auth-gate";
import { LegalFooterLinks } from "@/components/legal-footer-links";

const CLERK_ENABLED = isClerkEnabled();

export default function SignUpPage() {
  const isNative = isCapacitorNative();
  const { isLoaded, isSignedIn } = useAuth();
  const [, navigate] = useLocation();
  const isDark = useIsDarkActive();
  const [requestedRole, setRequestedRole] = useState<SignupRequestedRole | null>(null);
  const [vetLicenseNumber, setVetLicenseNumber] = useState("");
  const trimmedLicense = vetLicenseNumber.trim();
  // The license field sits outside Clerk's form, so `required` can't block its
  // submit. Gate the Clerk sign-up (and the social buttons) on a valid license
  // when vet is requested, so a vet can't complete sign-up without one — which
  // would otherwise strand them at the pending→active approval gate.
  const vetLicenseReady = requestedRole !== "vet" || trimmedLicense.length >= 3;

  // Invite link `/signup?clinic=CODE`: stash the join code so the post-auth
  // JoinClinicScreen can redeem it after Clerk's redirects (join-code-store).
  useEffect(() => {
    captureJoinCodeFromSearch(window.location.search);
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate("/", { replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <>
      <Helmet>
        <title>{t.authPage.signUpMetaTitle}</title>
        <meta name="description" content={t.authPage.signUpMetaDescription} />
        <link rel="canonical" href="https://vettrack.uk/signup" />
        <meta name="robots" content="noindex" />
      </Helmet>

      <AuthDoorChrome
        title={t.authPage.createAccount}
        subtitle={t.authPage.signUpSubtitle}
        footer={<LegalFooterLinks />}
      >
        <RoleChips selectedRole={requestedRole} onSelectRole={setRequestedRole} />

        {requestedRole === "vet" && (
          <div className="mb-5 flex flex-col gap-1.5">
            <Label htmlFor="vetLicenseNumber" className="vt-text-xs font-semibold text-ivory-text">
              {t.authPage.vetLicenseLabel}
            </Label>
            <Input
              id="vetLicenseNumber"
              name="vetLicenseNumber"
              inputMode="text"
              autoComplete="off"
              required
              maxLength={40}
              value={vetLicenseNumber}
              onChange={(event) => setVetLicenseNumber(event.target.value)}
              placeholder={t.authPage.vetLicensePlaceholder}
              data-testid="vet-license-input"
              className="min-h-[44px] rounded-md border-ivory-border bg-ivory-surface"
            />
            <p className="vt-text-xs text-ivory-text3">{t.authPage.vetLicenseHint}</p>
          </div>
        )}

        {CLERK_ENABLED ? (
          <div className="flex w-full flex-col items-center gap-4">
            <ClerkLoading>
              <div className="flex w-full min-h-[12rem] justify-center items-center" aria-busy>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            </ClerkLoading>
            <ClerkFailed>
              <p className="vt-text-sm text-center text-destructive px-2" role="alert">
                {t.authPage.signUpLoadError}
              </p>
            </ClerkFailed>
            <ClerkLoaded>
              <ClerkAuthFormShell>
                <OfflineAuthGate>
                  <div className="w-full min-h-[24rem] flex flex-col items-center justify-start gap-4">
                    {!vetLicenseReady ? (
                      <p
                        className="vt-text-sm text-center text-ivory-text2 px-2 py-8"
                        data-testid="vet-license-gate"
                      >
                        {t.authPage.vetLicenseRequired}
                      </p>
                    ) : (
                      <>
                        {isNative ? <NativeSocialButtons mode="signUp" /> : null}
                        <SignUp
                          routing="hash"
                          signInUrl="/signin"
                          fallbackRedirectUrl="/"
                          unsafeMetadata={
                            requestedRole
                              ? {
                                  requestedRole,
                                  ...(requestedRole === "vet" && trimmedLicense
                                    ? { vetLicenseNumber: trimmedLicense }
                                    : {}),
                                }
                              : undefined
                          }
                          appearance={isNative ? getClerkAppearanceNative(isDark) : getClerkAppearance(isDark)}
                        />
                      </>
                    )}
                  </div>
                </OfflineAuthGate>
              </ClerkAuthFormShell>
            </ClerkLoaded>
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
}
