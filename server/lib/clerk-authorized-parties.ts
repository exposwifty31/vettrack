/**
 * Resolve the Clerk `authorizedParties` allowlist.
 *
 * Clerk validates the `azp` claim of incoming session JWTs against this list to
 * defend against token-reuse across origins. The native Capacitor shell calls
 * `/api` from the WebView origins (`capacitor://localhost` / `ionic://localhost`),
 * so those must be present alongside the production web host.
 */

/** Capacitor bundled-shell WebView origins (native app issues `azp` from these). */
const CAPACITOR_WEBVIEW_ORIGINS = ["capacitor://localhost", "ionic://localhost"] as const;

/** Localhost dev origins (Vite on :5000, API on :3001). */
const LOCAL_DEV_ORIGINS = ["http://localhost:5000", "http://localhost:3001"] as const;

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/** Bare ↔ `www.` alternate for the same origin; null when parsing fails or unchanged. */
function alternateWwwOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    url.hostname = url.hostname.startsWith("www.")
      ? url.hostname.slice(4)
      : `www.${url.hostname}`;
    const alternate = url.origin;
    return alternate === origin ? null : alternate;
  } catch {
    return null;
  }
}

/**
 * Build the authorized-parties allowlist for the resolved environment.
 *
 * Always includes the Capacitor WebView origins. In production the configured
 * `ALLOWED_ORIGIN` host is added in both bare and `www.` forms; outside
 * production the localhost dev origins are added so browser-based dev works.
 */
export function resolveClerkAuthorizedParties(isProduction: boolean): string[] {
  const parties = new Set<string>(CAPACITOR_WEBVIEW_ORIGINS);

  const allowedOrigin = normalizeOrigin(process.env.ALLOWED_ORIGIN);
  if (allowedOrigin) {
    parties.add(allowedOrigin);
    const wwwAlternate = alternateWwwOrigin(allowedOrigin);
    if (wwwAlternate) {
      parties.add(wwwAlternate);
    }
  }

  if (!isProduction) {
    for (const origin of LOCAL_DEV_ORIGINS) {
      parties.add(origin);
    }
  }

  return Array.from(parties);
}
