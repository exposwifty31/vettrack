import { usePlatformTarget } from "@/shared/platform";

/**
 * True when running as a Capacitor native app or narrow touch viewport.
 *
 * @deprecated Prefer usePlatformTarget() from @/shared/platform for new code.
 * Retained for backward compat with callers that predate the shared/platform kernel.
 */
export function useIsMobile(): boolean {
  return usePlatformTarget() === "mobile";
}
