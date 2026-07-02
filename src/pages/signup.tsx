import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { VetTrackMark } from "@/components/vettrack-mark";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/use-auth";
import { clerkAppearance, clerkAppearanceNative } from "@/lib/clerk-appearance";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { ClerkAuthFormShell } from "@/components/clerk-auth-form-shell";
import { NativeSocialButtons } from "@/components/native-social-buttons";
import { LegalFooterLinks } from "@/components/legal-footer-links";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export default function SignUpPage() {
  const isNative = isCapacitorNative();
  const { isLoaded, isSignedIn } = useAuth();
  const [, navigate] = useLocation();

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
        <link rel="canonical" href="https://vettrack.replit.app/signup" />
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

          <div className="mb-6 flex flex-col items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
              {t.authPage.roleLabel}
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              <span className="inline-flex h-8 items-center rounded-full border border-primary bg-primary px-3.5 text-xs font-semibold text-primary-foreground">
                {t.authPage.roleVetTech}
              </span>
              <span className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-foreground">
                {t.authPage.roleVeterinarian}
              </span>
              <span className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-foreground">
                {t.authPage.roleStudent}
              </span>
            </div>
          </div>

          {CLERK_PUBLISHABLE_KEY ? (
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
                  <div className="w-full min-h-[24rem] flex flex-col items-center justify-start gap-4">
                    {isNative ? <NativeSocialButtons mode="signUp" /> : null}
                    <SignUp
                      routing="hash"
                      signInUrl="/signin"
                      fallbackRedirectUrl="/"
                      appearance={isNative ? clerkAppearanceNative : clerkAppearance}
                    />
                  </div>
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
}
