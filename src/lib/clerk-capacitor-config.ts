import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { getCurrentLocale, type Locale } from "@/lib/i18n";
import { enUS, heIL } from "@clerk/localizations";

/** OAuth + WebView origins allowed for Clerk redirect validation in the native shell. */
export const CLERK_NATIVE_REDIRECT_ORIGINS = [
  "vettrack://oauth-callback",
  "vettrack://",
  "capacitor://localhost",
  "ionic://localhost",
] as const;

const CLERK_WEB_REDIRECT_ORIGINS = ["vettrack://oauth-callback", "vettrack://"] as const;

/** Clerk's official localization resource shape, from `@clerk/localizations`. */
type ClerkLocalization = typeof enUS;

export type ClerkProviderRuntimeProps = {
  publishableKey: string;
  allowedRedirectOrigins: string[];
  allowedRedirectProtocols?: string[];
  standardBrowser?: boolean;
  localization: ClerkLocalization;
};

/**
 * Maps the app's current locale to Clerk's official localization resource
 * (T8 — the Clerk sign-in card previously always rendered in English
 * regardless of the surrounding Hebrew chrome). Hebrew is the app default;
 * every other locale falls back to English.
 */
export function clerkLocalizationForLocale(locale: Locale): ClerkLocalization {
  return locale === "he" ? heIL : enUS;
}

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
export function clerkProviderPropsForRuntime(
  publishableKey: string,
  locale: Locale = getCurrentLocale(),
): ClerkProviderRuntimeProps {
  const localization = clerkLocalizationForLocale(locale);

  if (isCapacitorNative()) {
    return {
      publishableKey,
      allowedRedirectOrigins: [...CLERK_NATIVE_REDIRECT_ORIGINS],
      // Non-standard-browser clerk-js syncs an existing session by NAVIGATING to
      // the current URL with the client JWT in the hash. windowNavigate only
      // allows http(s) plus these — without "capacitor:" the sync bounces to
      // "/" and the WebView reload-loops on every boot with a stored session.
      allowedRedirectProtocols: ["capacitor:", "vettrack:"],
      standardBrowser: false,
      localization,
    };
  }

  return {
    publishableKey,
    allowedRedirectOrigins: [...CLERK_WEB_REDIRECT_ORIGINS],
    localization,
  };
}
