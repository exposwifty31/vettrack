import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { VetTrackMark } from "@/components/vettrack-mark";
import { RoleChips, type SignupRequestedRole } from "@/features/auth/components/RoleChips";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readCarriedRole } from "@/features/auth/requested-role-store";
import { writeCarriedJoinCode } from "@/features/auth/join-code-store";
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
  const [requestedRole, setRequestedRole] = useState<SignupRequestedRole | null>(() => readCarriedRole());
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
    const code = new URLSearchParams(window.location.search).get("clinic");
    if (code) writeCarriedJoinCode(code.trim());
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
            <h1 className="text-2xl font-bold text-foreground mb-2">{t.authPage.createAccount}</h1>
            <p className="text-sm text-muted-foreground">{t.authPage.signUpSubtitle}</p>
          </div>

          <RoleChips selectedRole={requestedRole} onSelectRole={setRequestedRole} />

          {requestedRole === "vet" && (
            <div className="mb-6 flex flex-col gap-1.5">
              <Label htmlFor="vetLicenseNumber" className="text-xs font-semibold text-foreground">
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
              />
              <p className="text-[11px] text-muted-foreground">{t.authPage.vetLicenseHint}</p>
            </div>
          )}

          {CLERK_ENABLED ? (
            <div className="flex flex-col items-center gap-4 w-full">
              <ClerkLoading>
                <div className="flex w-full min-h-[12rem] justify-center items-center" aria-busy>
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              </ClerkLoading>
              <ClerkFailed>
                <p className="text-sm text-center text-destructive px-2" role="alert">
                  {t.authPage.signUpLoadError}
                </p>
              </ClerkFailed>
              <ClerkLoaded>
                <ClerkAuthFormShell>
                  <OfflineAuthGate>
                  <div className="w-full min-h-[24rem] flex flex-col items-center justify-start gap-4">
                    {!vetLicenseReady ? (
                      <p
                        className="text-sm text-center text-muted-foreground px-2 py-8"
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
          </div>
        </div>
      </div>
    </>
  );
}
