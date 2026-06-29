import { Redirect } from "wouter";
import { type ReactNode } from "react";
import { isCapacitorNative } from "@/lib/capacitor-runtime";

type Props = { children: ReactNode; fallback?: string };

/**
 * Redirects Capacitor-native users away from web-only routes.
 * Place inside AuthGuard so auth is resolved before platform check.
 */
export function WebOnlyGuard({ children, fallback = "/home" }: Props) {
  if (isCapacitorNative()) {
    return <Redirect to={fallback} replace />;
  }
  return <>{children}</>;
}
