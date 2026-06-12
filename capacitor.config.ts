import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor shell for iOS/Android native NFC (Equipment Hero phase 5).
 *
 * - Default: bundled `dist/public` from `pnpm build` (offline-capable shell).
 * - Live reload / staging: set CAPACITOR_SERVER_URL (e.g. https://vettrack.uk).
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "uk.vettrack.app",
  appName: "VetTrack",
  webDir: "dist/public",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
        androidScheme: serverUrl.startsWith("https") ? "https" : "http",
      }
    : undefined,
  ios: {
    // "never": the WebView spans the full screen and the web layer owns safe
    // areas via viewport-fit=cover + env(safe-area-inset-*) — same rendering as
    // the installed PWA. "automatic" let WKWebView inset scroll content
    // natively, which fought the CSS and pushed content under the status bar.
    contentInset: "never",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
