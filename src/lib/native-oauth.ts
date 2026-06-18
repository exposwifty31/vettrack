/**
 * Native (Capacitor) OAuth via the system browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * Apple and Google both BLOCK their OAuth authorization pages inside embedded
 * WebViews (Apple: silent failure / "invalid_client"-style error; Google:
 * `disallowed_useragent`). The VetTrack iOS app is a Capacitor shell whose web
 * bundle runs in a WKWebView at the `capacitor://localhost` origin, so Clerk's
 * default in-component social buttons (which navigate the WebView straight to
 * the provider) fail. App Review flagged exactly this (Guideline 2.1a — the
 * "error when registering a new account with Apple").
 *
 * THE FIX
 * -------
 * Run the SAME Clerk web OAuth connection (already fully configured in the Clerk
 * dashboard — Apple Services ID `uk.vettrack.app.signin`, Google) but open the
 * provider authorize URL in the SYSTEM browser (SFSafariViewController /
 * ASWebAuthenticationSession via `@capacitor/browser`). Apple explicitly permits
 * OAuth through these. The provider then redirects back to our custom URL scheme
 * (`OAUTH_REDIRECT_URL`), Capacitor's `App` plugin delivers the callback via the
 * `appUrlOpen` event, and we complete the Clerk sign-in (or transfer to sign-up
 * for brand-new users).
 *
 * This module is ONLY used when `isCapacitorNative()` is true. On the web, the
 * standard Clerk `<SignIn />` / `<SignUp />` social buttons are used unchanged.
 *
 * DEVICE TESTING REQUIRED: this flow cannot be exercised in a headless/CI
 * environment — it needs a real device tapping the provider sheet. Verify on an
 * iPad/iPhone before submitting to App Review.
 */
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { linkNativeAppleRevocationAfterOAuth } from "@/lib/native-apple-link";
import { warmNativeClerkSessionToken } from "@/lib/native-clerk-session-token";

/*
 * Minimal structural types for the Clerk resources we touch. We intentionally do
 * NOT import from `@clerk/types` (deprecated upstream — see clerk-appearance.ts)
 * to keep this module's build independent of that package. These shapes are
 * satisfied structurally by the objects returned from `useSignIn()` /
 * `useSignUp()` in `@clerk/clerk-react`.
 */
interface OAuthVerification {
  status?: string | null;
  externalVerificationRedirectURL?: URL | null;
}

interface SignInResource {
  status?: string | null;
  createdSessionId?: string | null;
  firstFactorVerification?: OAuthVerification;
  create(params: { strategy: string; redirectUrl: string }): Promise<unknown>;
  reload(params?: { rotatingTokenNonce: string }): Promise<unknown>;
}
interface SignUpResource {
  status?: string | null;
  createdSessionId?: string | null;
  create(params: { transfer: boolean }): Promise<unknown>;
}
type SetActive = (params: { session: string }) => Promise<unknown>;

/**
 * Custom URL scheme callback. MUST match:
 *  - `CFBundleURLSchemes` in `ios/App/App/Info.plist` (scheme: `vettrack`)
 *  - the allowed redirect list in the Clerk dashboard
 *    (Configure → Paths/Native applications → allowed redirect URLs)
 */
export const OAUTH_REDIRECT_URL = "vettrack://oauth-callback";

export type NativeOAuthStrategy = "oauth_apple" | "oauth_google";

type StartArgs = {
  strategy: NativeOAuthStrategy;
  signIn: SignInResource;
  signUp: SignUpResource;
  setActive: SetActive;
};

/** Wait for the Capacitor `appUrlOpen` event that matches our redirect scheme. */
function waitForCallbackUrl(timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void removeHandle();
      reject(new Error("OAUTH_TIMEOUT"));
    }, timeoutMs);

    let handlePromise = App.addListener("appUrlOpen", (event) => {
      if (settled) return;
      if (!event?.url || !event.url.startsWith(OAUTH_REDIRECT_URL)) return;
      settled = true;
      clearTimeout(timer);
      void removeHandle();
      resolve(event.url);
    });

    async function removeHandle() {
      try {
        const handle = await handlePromise;
        await handle.remove();
      } catch {
        /* listener already gone */
      }
    }
  });
}

async function completeNativeClerkSession(
  signIn: SignInResource,
  signUp: SignUpResource,
  setActive: SetActive,
): Promise<void> {
  if (signIn.status === "complete" && signIn.createdSessionId) {
    await setActive({ session: signIn.createdSessionId });
    await warmNativeClerkSessionToken();
    return;
  }

  const transferable = signIn.firstFactorVerification?.status === "transferable";
  if (transferable) {
    await signUp.create({ transfer: true });
    if (signUp.status === "complete" && signUp.createdSessionId) {
      await setActive({ session: signUp.createdSessionId });
      await warmNativeClerkSessionToken();
      return;
    }
    throw new Error(`OAUTH_SIGNUP_INCOMPLETE_${signUp.status ?? "unknown"}`);
  }

  throw new Error(`OAUTH_SIGNIN_INCOMPLETE_${signIn.status ?? "unknown"}`);
}

/**
 * Drive a full native OAuth round-trip for `strategy`, completing either a
 * sign-in (existing user) or a transferred sign-up (new user — the reviewer's
 * "register a new account with Apple" path).
 *
 * Throws on failure; callers should surface a user-visible error and allow retry.
 */
export async function startNativeOAuth({
  strategy,
  signIn,
  signUp,
  setActive,
}: StartArgs): Promise<void> {
  // 1. Begin a sign-in attempt with the OAuth strategy. Clerk returns an
  //    external authorize URL instead of navigating us there itself.
  await signIn.create({ strategy, redirectUrl: OAUTH_REDIRECT_URL });

  const externalUrl =
    signIn.firstFactorVerification?.externalVerificationRedirectURL;
  if (!externalUrl) {
    throw new Error("OAUTH_NO_EXTERNAL_URL");
  }

  // 2. Register the callback listener BEFORE opening the browser to avoid a
  //    race where the redirect fires before we are listening.
  const callbackPromise = waitForCallbackUrl();

  // 3. Open the provider authorize page in the system browser.
  await Browser.open({ url: externalUrl.toString(), windowName: "_self" });

  // 4. Await the deep-link callback, then dismiss the browser.
  const callbackUrl = await callbackPromise;
  try {
    await Browser.close();
  } catch {
    /* already closed by the system */
  }

  // 5. Clerk hands back a rotating token nonce on the callback URL; reload the
  //    sign-in with it to advance the attempt.
  const nonce = new URL(callbackUrl).searchParams.get("rotating_token_nonce");
  await signIn.reload(
    nonce ? ({ rotatingTokenNonce: nonce } as { rotatingTokenNonce: string }) : undefined,
  );

  await completeNativeClerkSession(signIn, signUp, setActive);

  // Apple revocation code is not available from the browser OAuth callback — capture
  // it via the native sheet after the Clerk session is active (requires auth for
  // POST /api/users/apple-link). Non-fatal if the user dismisses or sim fails.
  if (strategy === "oauth_apple") {
    await linkNativeAppleRevocationAfterOAuth();
  }
}
