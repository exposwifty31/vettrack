import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { VetTrackMark } from "@/components/vettrack-mark";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, useUser } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/use-auth";
import { PhoneSignIn } from "@/components/phone-sign-in";
import { clerkAppearance, clerkAppearanceNative } from "@/lib/clerk-appearance";
import { usePlatformTarget } from "@/shared/platform";
import { ClerkAuthFormShell } from "@/components/clerk-auth-form-shell";
import { AuthBootstrapSpinner } from "@/components/native-clerk-gate";
import { NativeSocialButtons } from "@/components/native-social-buttons";
import { LegalFooterLinks } from "@/components/legal-footer-links";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export default function SignInPage() {
  const isNative = usePlatformTarget() === "mobile";
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useUser();
  const [, navigate] = useLocation();
  const [usePhoneFlow, setUsePhoneFlow] = useState(false);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate("/home");
    }
  }, [isLoaded, isSignedIn, navigate]);

  // Clerk session exists but VetTrack context has not confirmed sign-in yet.
  // Do NOT mount <SignIn> — it auto-redirects to fallbackRedirectUrl (/home) while
  // AuthGuard still sees isSignedIn=false → /home ↔ /signin redirect loop.
  if (clerkLoaded && clerkSignedIn && !isSignedIn) {
    return (
      <>
        <Helmet>
          <title>כניסה — VetTrack</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <AuthBootstrapSpinner />
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>כניסה — VetTrack</title>
        <meta name="description" content="התחבר ל-VetTrack לניהול ציוד וטרינרי, סריקת QR ומעקב בזמן אמת." />
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
            <h1 className="text-2xl font-bold text-foreground mb-2">ברוך שובך</h1>
            <p className="text-sm text-muted-foreground">התחבר לניהול ציוד הוטרינרי שלך</p>
          </div>

          {CLERK_PUBLISHABLE_KEY ? (
            <div className="flex flex-col items-center gap-4">
              {usePhoneFlow ? (
                <>
                  <PhoneSignIn />
                  <button
                    type="button"
                    onClick={() => setUsePhoneFlow(false)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    → חזרה להתחברות רגילה
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
                      דף ההתחברות לא נטען. בדוק את החיבור ורענן. אם הבעיה נמשכת, ודא ש-Clerk מוגדר לדומיין זה ושמפתח ה-Publishable Key תואם לסביבה.
                    </p>
                  </ClerkFailed>
                  <ClerkLoaded>
                    <ClerkAuthFormShell>
                      <div className="w-full min-h-[24rem] flex flex-col items-center justify-start gap-4">
                        {isNative ? <NativeSocialButtons mode="signIn" /> : null}
                        <SignIn
                          routing="hash"
                          signUpUrl="/signup"
                          fallbackRedirectUrl="/home"
                          appearance={isNative ? clerkAppearanceNative : clerkAppearance}
                        />
                      </div>
                    </ClerkAuthFormShell>
                  </ClerkLoaded>
                  <p className="text-xs text-muted-foreground text-center max-w-xs">
                    מתחבר עם מספר ישראלי (+972)?{" "}
                    <button
                      type="button"
                      onClick={() => setUsePhoneFlow(true)}
                      className="underline hover:text-primary transition-colors"
                    >
                      השתמש בהתחברות ממספר טלפון ישראלי
                    </button>{" "}
                    להזנת המספר בפורמט מקומי (לדוגמה: 0501234567).
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm text-center">
              <p className="text-sm text-muted-foreground mb-4">
                מצב פיתוח — אין צורך באימות.
              </p>
              <Link
                href="/home"
                className="inline-flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-4 py-3 rounded-xl transition-colors"
              >
                כניסה ללוח הבקרה
              </Link>
            </div>
          )}

          <div className="text-center mt-6 space-y-3">
            <LegalFooterLinks />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              → עוד על VetTrack
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
