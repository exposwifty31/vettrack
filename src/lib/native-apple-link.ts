/**
 * Native Sign in with Apple credential capture for Capacitor iOS.
 *
 * Apple issues a single-use `authorizationCode` only during the native
 * ASAuthorizationController flow. Clerk's system-browser OAuth path does not
 * surface that code — use this module when linking a revocation token after sign-in.
 */
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { linkAppleAuthorizationCode } from "@/lib/api";

/** iOS App ID — must match `APPLE_CLIENT_ID` on the server for token exchange. */
export const NATIVE_APPLE_CLIENT_ID = "uk.vettrack.app";

export type NativeAppleCredential = {
  identityToken: string;
  authorizationCode: string | null;
  givenName: string | null;
  familyName: string | null;
};

/**
 * Run the native Apple authorization sheet and return the credential payload.
 * After system-browser OAuth sign-in, only `authorizationCode` is consumed
 * (for deletion-time revocation); the identity token is not sent to Clerk.
 */
export async function requestNativeAppleCredential(): Promise<NativeAppleCredential> {
  if (!isCapacitorNative()) {
    throw new Error("NATIVE_APPLE_UNAVAILABLE");
  }

  const result = await SignInWithApple.authorize({
    clientId: NATIVE_APPLE_CLIENT_ID,
    redirectURI: "https://vettrack.uk",
    scopes: "email name",
  });

  const identityToken = result.response?.identityToken?.trim();
  if (!identityToken) {
    throw new Error("NATIVE_APPLE_NO_IDENTITY_TOKEN");
  }

  const authorizationCode = result.response?.authorizationCode?.trim() || null;

  return {
    identityToken,
    authorizationCode,
    givenName: result.response?.givenName?.trim() || null,
    familyName: result.response?.familyName?.trim() || null,
  };
}

/**
 * Link a captured authorization code to the authenticated VetTrack user.
 * Non-fatal — deletion still works without a stored Apple token.
 */
export async function linkCapturedAppleAuthorizationCode(
  authorizationCode: string | null,
): Promise<void> {
  const code = authorizationCode?.trim();
  if (!code) return;

  try {
    await linkAppleAuthorizationCode(code);
  } catch (err) {
    console.warn("[native-apple-link] could not link authorization code", {
      err: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * After a successful Clerk Apple OAuth sign-in (system browser), prompt the native
 * Apple sheet once to capture the single-use `authorizationCode` for server-side
 * token exchange. Non-fatal — see `docs/account-deletion.md`.
 */
export async function linkNativeAppleRevocationAfterOAuth(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const credential = await requestNativeAppleCredential();
    await linkCapturedAppleAuthorizationCode(credential.authorizationCode);
  } catch (err) {
    console.warn("[native-apple-link] revocation capture after OAuth failed (non-fatal)", {
      err: err instanceof Error ? err.message : err,
    });
  }
}
