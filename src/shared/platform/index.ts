import { isCapacitorNative } from "@/lib/capacitor-runtime";

/** The two runtime deployment targets. */
export type PlatformTarget = "native" | "web";

/**
 * Synchronous (no re-render) resolution of the current platform target.
 * Safe to call at module initialisation time or inside hooks.
 */
export function resolvePlatformTarget(): PlatformTarget {
  return isCapacitorNative() ? "native" : "web";
}

/**
 * Hook form of resolvePlatformTarget. The result is stable for the lifetime
 * of the JS context — Capacitor platform never changes at runtime.
 */
export function usePlatformTarget(): PlatformTarget {
  return resolvePlatformTarget();
}
