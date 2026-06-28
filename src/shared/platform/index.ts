import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { isCapacitorNative } from "@/lib/capacitor-runtime";

/** The three runtime deployment targets. */
export type PlatformTarget = "mobile" | "desktop" | "marketing";

/** Public routes that belong to the marketing shell (no app chrome). */
const MARKETING_PATHS = new Set(["/", "/landing", "/signin", "/signup", "/privacy", "/terms", "/support"]);

/** True for narrow touch viewports: covers installed PWA + mobile Safari. */
export function isTouchNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches;
}

/** Single source of truth for the marketing-path predicate (used by both isMarketingPath and usePlatformTarget). */
function isMarketingPathname(pathname: string): boolean {
  return MARKETING_PATHS.has(pathname) || pathname.startsWith("/signin") || pathname.startsWith("/signup");
}

/** True when the current path belongs to the public/unauthenticated marketing shell. */
export function isMarketingPath(): boolean {
  if (typeof window === "undefined") return false;
  return isMarketingPathname(window.location.pathname);
}

/**
 * Synchronous (no re-render) resolution of the current platform target.
 * Safe to call at module initialisation time or inside hooks.
 *
 *   mobile    — Capacitor native OR narrow touch viewport (PWA / mobile-Safari)
 *   marketing — public unauthenticated routes
 *   desktop   — everything else (wide viewport, pointer device)
 */
export function resolvePlatformTarget(): PlatformTarget {
  if (isCapacitorNative() || isTouchNarrow()) return "mobile";
  if (isMarketingPath()) return "marketing";
  return "desktop";
}

/**
 * Reactive hook form of resolvePlatformTarget. Re-evaluates on client-side
 * navigation (via wouter) and on viewport/pointer-device changes (via matchMedia).
 *
 * Only touchNarrow lives in state (driven by a media query event). The
 * path-dependent target is derived synchronously during render to avoid a
 * one-render stale frame when the location changes.
 */
export function usePlatformTarget(): PlatformTarget {
  const [pathname] = useLocation();
  const [touchNarrow, setTouchNarrow] = useState(() => isTouchNarrow());

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
    const handler = () => setTouchNarrow(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (isCapacitorNative() || touchNarrow) return "mobile";
  if (isMarketingPathname(pathname)) return "marketing";
  return "desktop";
}
