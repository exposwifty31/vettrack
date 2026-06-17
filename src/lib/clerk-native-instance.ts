/**
 * Self-constructed clerk-js instance for the Capacitor bundled shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * `standardBrowser: false` alone is not enough on a production Clerk instance:
 * clerk-js still creates a *web* client, whose OAuth `state` is only honored at
 * `/v1/oauth_callback` when the request presents the client's cookie. The system
 * browser (SFSafariViewController) cannot present the WKWebView's cookies, so the
 * callback dies with `err_code=authorization_invalid` after the provider redirects.
 *
 * Clerk's own native SDKs (Expo/iOS) solve this by marking every Frontend API
 * request as native (`_is_native=1`) and carrying the client identity in the
 * `Authorization` header instead of cookies. FAPI then issues OAuth `state`
 * values that self-authorize the callback — verified against this production
 * instance: a state created with `_is_native=1` 303s straight back to
 * `vettrack://oauth-callback`, while the same flow without it reproduces the
 * `authorization_invalid` bounce byte-for-byte.
 *
 * This module replicates that transport using clerk-js's request hooks (the same
 * mechanism `@clerk/clerk-expo` uses), with the client JWT persisted in
 * localStorage of the `capacitor://localhost` origin. Used ONLY in the native
 * shell — the web app keeps the hot-loaded, cookie-based clerk-js unchanged.
 */
import { Clerk } from "@clerk/clerk-js";
import { CLERK_CLIENT_JWT_STORAGE_KEY } from "@/lib/native-clerk-session-token";

function readStoredClientJwt(): string {
  try {
    return window.localStorage.getItem(CLERK_CLIENT_JWT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeClientJwt(jwt: string): void {
  try {
    window.localStorage.setItem(CLERK_CLIENT_JWT_STORAGE_KEY, jwt);
  } catch {
    /* storage unavailable — the next response will retry */
  }
}

export function createNativeClerkInstance(publishableKey: string): Clerk {
  const clerk = new Clerk(publishableKey);

  clerk.__unstable__onBeforeRequest(async (requestInit) => {
    // Cookies never authorize this client; the JWT in the header does.
    requestInit.credentials = "omit";
    requestInit.url?.searchParams.set("_is_native", "1");

    const headers = new Headers(requestInit.headers);
    headers.set("authorization", readStoredClientJwt());
    requestInit.headers = headers;
  });

  clerk.__unstable__onAfterResponse(async (_requestInit, response) => {
    const header = response?.headers?.get("authorization");
    if (header) {
      storeClientJwt(header);
    }
  });

  return clerk;
}
