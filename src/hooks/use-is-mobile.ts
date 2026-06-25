import { isCapacitorNative } from "@/lib/capacitor-runtime";

/**
 * True when running as a Capacitor native app.
 * Sprint 1.2+ will extend this to include mobile browser viewports.
 */
export function useIsMobile(): boolean {
  return isCapacitorNative();
}
