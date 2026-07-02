import { useEffect, useState } from "react";
import { capacitorPlatform } from "@/lib/capacitor-runtime";

/**
 * The one scan-affordance decision for the whole app.
 *
 *   tab  — native phone: a flat, emphasized scan tab in the bottom tab bar
 *   fab  — native tablet: a floating scan action button (iPad has no bottom bar)
 *   none — web (any viewport): no scan UI at all
 *
 * This is the single gate every scan surface must consume. Do not scatter
 * platform checks — read this instead.
 */
export type ScanAffordance = "tab" | "fab" | "none";

export interface ScanAffordanceSignals {
  /** Running inside the Capacitor native shell (iOS/Android), not a browser. */
  isNative: boolean;
  /** Viewport is tablet-width (≥ the tablet breakpoint). */
  isTablet: boolean;
}

/** Pure, testable gate. Web → none; native phone → tab; native tablet → fab. */
export function scanAffordance({ isNative, isTablet }: ScanAffordanceSignals): ScanAffordance {
  if (!isNative) return "none";
  return isTablet ? "fab" : "tab";
}

const TABLET_MEDIA_QUERY = "(min-width: 768px)";

function readIsTablet(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(TABLET_MEDIA_QUERY).matches;
}

/** Reactive hook wrapping the runtime signals around the pure gate. */
export function useScanAffordance(): ScanAffordance {
  const [isTablet, setIsTablet] = useState<boolean>(readIsTablet);

  useEffect(() => {
    const mq = window.matchMedia(TABLET_MEDIA_QUERY);
    const handler = () => setIsTablet(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const isNative = capacitorPlatform() !== "web";
  return scanAffordance({ isNative, isTablet });
}
