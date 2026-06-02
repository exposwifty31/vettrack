import { Capacitor } from "@capacitor/core";

/** True when running inside the VetTrack Capacitor shell (iOS/Android). */
export function isCapacitorNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** WebView platform id: `ios` | `android` | `web`. */
export function capacitorPlatform(): string {
  return Capacitor.getPlatform();
}
