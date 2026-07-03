import { useIsTabletViewport } from "@/lib/use-tablet-viewport";
import { capacitorPlatform } from "@/lib/capacitor-runtime";

/**
 * The single gate for iPad-only behavior: the native (Capacitor) tablet app.
 *
 * Drives the two-pane master-detail layouts and the iPad chat header button.
 * Deliberately context-independent (does NOT read `useNativeShellContext`) so it
 * also works outside the NativeShell provider — e.g. the global chat mount in
 * `main.tsx`. This is equivalent to `useNativeShellContext() && useIsTabletViewport()`
 * for every real case: Capacitor-native always resolves to the mobile shell, and
 * the web mobile shell only renders below the tablet width, so a tablet-width
 * viewport that is also native is always the iPad app.
 */
export function useIsNativeTablet(): boolean {
  const isTablet = useIsTabletViewport();
  return isTablet && capacitorPlatform() !== "web";
}
