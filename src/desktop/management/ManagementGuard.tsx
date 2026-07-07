import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { useExperience } from "@/hooks/use-experience";

/**
 * Capability gate for the web management console (Phase 6). Mount INSIDE
 * `AuthGuard` + `WebOnlyGuard` (auth → platform → capability). Admits admin, lead,
 * and secondary-admin (`management.web`); redirects everyone else home.
 *
 * Do NOT hard-gate on `role === "admin"` — that would exclude lead, who is a
 * first-class read-only console user (I.4). Server stays the enforcement boundary.
 */
export function ManagementGuard({ children }: { children: ReactNode }) {
  const experience = useExperience();
  if (!experience.can("management.web")) return <Redirect to="/home" replace />;
  return <>{children}</>;
}
