/**
 * Capture Apple's single-use `authorizationCode` after native Sign in with Apple
 * so the server can exchange it for a refresh token (account-deletion revocation).
 *
 * Clerk's system-browser OAuth path does not surface this code; the Capacitor
 * community plugin requests it from the native ASAuthorizationController API.
 * Failures are non-fatal — deletion still works without a stored Apple token.
 */
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { linkAppleAuthorizationCode } from "@/lib/api";

/** iOS App ID — must match `APPLE_CLIENT_ID` on the server for token exchange. */
const NATIVE_APPLE_CLIENT_ID = "uk.vettrack.app";

/**
 * After a successful native Apple OAuth sign-in, request the authorization code
 * and link it to the authenticated VetTrack user. Fire-and-forget safe.
 */
export async function linkNativeAppleAuthorizationCodeAfterSignIn(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const result = await SignInWithApple.authorize({
      clientId: NATIVE_APPLE_CLIENT_ID,
      redirectURI: "https://vettrack.uk",
      scopes: "email name",
    });

    const code = result.response?.authorizationCode?.trim();
    if (!code) return;

    await linkAppleAuthorizationCode(code);
  } catch (err) {
    // Non-fatal: user is signed in; revocation may fall back to Apple's manual path.
    console.warn("[native-apple-link] could not link authorization code", {
      err: err instanceof Error ? err.message : err,
    });
  }
}
