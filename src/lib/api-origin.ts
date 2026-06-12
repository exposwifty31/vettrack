import { isCapacitorNative } from "@/lib/capacitor-runtime";

function trimTrailingSlash(origin: string): string {
  return origin.replace(/\/$/, "");
}

/**
 * Production API host for the Capacitor bundled shell (`capacitor://localhost`).
 * Set at build time via VITE_API_ORIGIN (e.g. https://vettrack.uk).
 * Not needed when CAPACITOR_SERVER_URL loads the WebView from the live site.
 */
export function getConfiguredApiOrigin(): string | null {
  const raw = import.meta.env.VITE_API_ORIGIN?.trim();
  return raw ? trimTrailingSlash(raw) : null;
}

/** True when the WebView origin cannot serve same-origin /api routes. */
export function needsRemoteApiOrigin(): boolean {
  if (typeof window === "undefined") return false;
  if (!isCapacitorNative()) return false;
  const origin = window.location.origin;
  return origin.startsWith("capacitor://") || origin === "http://localhost" || origin === "https://localhost";
}

/**
 * Resolve a relative API path to an absolute URL when the native shell is bundled
 * without CAPACITOR_SERVER_URL. Browser/PWA and live-server Capacitor keep paths relative.
 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith("/")) return path;

  // Only the bundled native shell needs an absolute origin. Browser, PWA, dev
  // server, and live-server Capacitor must keep same-origin relative paths even
  // when VITE_API_ORIGIN happens to be set in the build environment.
  if (!needsRemoteApiOrigin()) return path;

  const configured = getConfiguredApiOrigin();
  if (configured) {
    return `${configured}${path}`;
  }

  console.error(
    "[api-origin] Bundled native app is missing VITE_API_ORIGIN — /api calls will hit the local shell.",
  );
  return path;
}
