import { capacitorPlatform } from "@/lib/capacitor-runtime";
import { useIsTabletViewport } from "@/lib/use-tablet-viewport";

/**
 * The one scan-affordance decision for the whole app.
 *
 *   tab  — native phone: a flat, emphasized scan tab in the bottom tab bar
 *   fab  — (retired) native tablet no longer uses a floating scan button
 *   none — web, or native tablet where Scan is a first-class sidebar nav item
 *          (no floating/tab scan surface on this device)
 *
 * This is the single gate every scan surface must consume. Do not scatter
 * platform checks — read this instead.
 */
export type ScanAffordance = "tab" | "fab" | "none";

export interface ScanAffordanceSignals {
  /** Running inside the Capacitor native shell (iOS/Android), not a browser. */
  isNative: boolean;
  /** Viewport is tablet-class (see `useIsTabletViewport` — width ≥768 and height ≥500). */
  isTablet: boolean;
}

/**
 * Pure, testable gate. Web → none; native phone → tab; native tablet → none
 * (Scan lives in the iPad sidebar nav, so there is no floating/tab affordance).
 */
export function scanAffordance({ isNative, isTablet }: ScanAffordanceSignals): ScanAffordance {
  if (!isNative) return "none";
  return isTablet ? "none" : "tab";
}

/** Reactive hook wrapping the runtime signals around the pure gate. */
export function useScanAffordance(): ScanAffordance {
  const isTablet = useIsTabletViewport();
  const isNative = capacitorPlatform() !== "web";
  return scanAffordance({ isNative, isTablet });
}
