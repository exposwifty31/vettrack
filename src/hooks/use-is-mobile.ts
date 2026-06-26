import { resolvePlatformTarget } from "@/shared/platform";

/**
 * True when running as a Capacitor native app.
 *
 * @deprecated Prefer usePlatformTarget() from @/shared/platform for new code.
 * Retained for backward compat with callers that predate the shared/platform kernel.
 */
export function useIsMobile(): boolean {
  return resolvePlatformTarget() === "native";
}
