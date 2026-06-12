import { isCapacitorNative } from "@/lib/capacitor-runtime";

/** OAuth + WebView origins allowed for Clerk redirect validation in the native shell. */
export const CLERK_NATIVE_REDIRECT_ORIGINS = [
  "vettrack://oauth-callback",
  "vettrack://",
  "capacitor://localhost",
  "ionic://localhost",
] as const;

const CLERK_WEB_REDIRECT_ORIGINS = ["vettrack://oauth-callback", "vettrack://"] as const;

export type ClerkProviderRuntimeProps = {
  publishableKey: string;
  allowedRedirectOrigins: string[];
  standardBrowser?: boolean;
};

/**
 * ClerkProvider props tuned for the current runtime (browser/PWA vs Capacitor shell).
 *
 * Capacitor WKWebView runs at `capacitor://localhost`; Clerk must allow that origin in
 * the dashboard (Configure → Native applications) in addition to these SDK props.
 *
 * `standardBrowser: false` is required in the shell: cookie-based ("standard browser")
 * clerk-js binds the client to a FAPI cookie the system browser cannot present during
 * the OAuth callback (→ `authorization_invalid`). Non-standard mode carries the client
 * JWT in the URL (`__clerk_db_jwt`), which survives the WKWebView → system-browser hop.
 */
export function clerkProviderPropsForRuntime(publishableKey: string): ClerkProviderRuntimeProps {
  if (isCapacitorNative()) {
    return {
      publishableKey,
      allowedRedirectOrigins: [...CLERK_NATIVE_REDIRECT_ORIGINS],
      standardBrowser: false,
    };
  }

  return {
    publishableKey,
    allowedRedirectOrigins: [...CLERK_WEB_REDIRECT_ORIGINS],
  };
}
