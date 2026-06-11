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
};

/**
 * ClerkProvider props tuned for the current runtime (browser/PWA vs Capacitor shell).
 *
 * Capacitor WKWebView runs at `capacitor://localhost`; Clerk must allow that origin in
 * the dashboard (Configure → Native applications) in addition to these SDK props.
 */
export function clerkProviderPropsForRuntime(publishableKey: string): ClerkProviderRuntimeProps {
  if (isCapacitorNative()) {
    return {
      publishableKey,
      allowedRedirectOrigins: [...CLERK_NATIVE_REDIRECT_ORIGINS],
    };
  }

  return {
    publishableKey,
    allowedRedirectOrigins: [...CLERK_WEB_REDIRECT_ORIGINS],
  };
}
