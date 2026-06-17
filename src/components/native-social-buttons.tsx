/**
 * Native (Capacitor) social sign-in buttons.
 *
 * Rendered ONLY inside the iOS/Android Capacitor shell, in place of Clerk's
 * built-in social buttons (which are hidden via `clerkAppearanceNative`). Tapping
 * a button runs `startNativeOAuth`, which opens the provider in the system
 * browser — the only way Apple/Google OAuth works from a WebView (see
 * `src/lib/native-oauth.ts`). On the web these buttons are never shown; the
 * standard Clerk social buttons are used instead.
 *
 * Labels are kept in English on purpose: they are brand-name actions shown to
 * App Review, and this avoids coupling the auth screens to the i18n codegen.
 */
import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { Apple, Loader2 } from "lucide-react";
import {
  startNativeOAuth,
  type NativeOAuthStrategy,
} from "@/lib/native-oauth";
import { linkNativeAppleAuthorizationCodeAfterSignIn } from "@/lib/native-apple-link";

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

type Mode = "signIn" | "signUp";

export function NativeSocialButtons({ mode }: { mode: Mode }) {
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [busy, setBusy] = useState<NativeOAuthStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = signInLoaded && signUpLoaded && !!signIn && !!signUp && !!setActive;

  async function handle(strategy: NativeOAuthStrategy) {
    if (!ready || busy) return;
    setError(null);
    setBusy(strategy);
    try {
      await startNativeOAuth({
        strategy,
        signIn: signIn as never,
        signUp: signUp as never,
        setActive: setActive as never,
      });
      if (strategy === "oauth_apple") {
        // Non-blocking: capture Apple's authorizationCode for deletion-time revocation.
        void linkNativeAppleAuthorizationCodeAfterSignIn();
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "OAUTH_FAILED";
      setError(
        code === "OAUTH_TIMEOUT"
          ? "Sign-in timed out. Please try again or sign in with email below."
          : strategy === "oauth_apple"
            ? "Apple sign-in didn't complete. Please try again."
            : "Google sign-in didn't complete. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const verb = mode === "signUp" ? "Sign up" : "Sign in";

  return (
    <div className="w-full flex flex-col gap-3" dir="ltr">
      <div className="flex items-center gap-3 py-1" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        disabled={!ready || busy !== null}
        onClick={() => handle("oauth_apple")}
        className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-border bg-background text-foreground font-medium hover:bg-muted transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`${verb} with Apple`}
      >
        {busy === "oauth_apple" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Apple className="h-[18px] w-[18px]" />
        )}
        <span>{verb} with Apple</span>
      </button>

      <button
        type="button"
        disabled={!ready || busy !== null}
        onClick={() => handle("oauth_google")}
        className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-border bg-background text-foreground font-medium hover:bg-muted transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`${verb} with Google`}
      >
        {busy === "oauth_google" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleGlyph />
        )}
        <span>{verb} with Google</span>
      </button>

      {error ? (
        <p className="text-xs text-center text-destructive px-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
