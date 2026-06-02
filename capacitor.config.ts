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
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
