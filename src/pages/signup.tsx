import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { setPostSignupLandingFlag } from "@/lib/post-signup-landing";
import { Helmet } from "react-helmet-async";
import { Loader2, QrCode } from "lucide-react";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/use-auth";
import { clerkAppearance } from "@/lib/clerk-appearance";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export default function SignUpPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setPostSignupLandingFlag();
      navigate("/", { replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <>
      <Helmet>
        <title>הרשמה — VetTrack</title>
        <meta name="description" content="צור חשבון VetTrack לניהול ציוד וטרינרי, סריקת QR ומעקב בזמן אמת." />
        <link rel="canonical" href="https://vettrack.replit.app/signup" />
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-[100dvh] bg-gradient-to-b from-primary/5 to-background flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 mb-6 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <QrCode className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-2xl font-bold text-foreground">VetTrack</span>
            </Link>
            <h1 className="text-2xl font-bold text-foreground mb-2">יצירת חשבון</h1>
            <p className="text-sm text-muted-foreground">הירשם לניהול ציוד הוטרינרי שלך</p>
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
                  דף ההרשמה לא נטען. בדוק את החיבור ורענן. אם הבעיה נמשכת, ודא ש-Clerk מוגדר לדומיין זה ושמפתח ה-Publishable Key תואם לסביבה.
                </p>
              </ClerkFailed>
              <ClerkLoaded>
                <div className="w-full min-h-[24rem] flex flex-col items-center justify-start">
                  <SignUp
                    routing="hash"
                    signInUrl="/signin"
                    fallbackRedirectUrl="/"
                    appearance={clerkAppearance}
                  />
                </div>
              </ClerkLoaded>
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

          <div className="text-center mt-6">
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
