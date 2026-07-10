import { Redirect } from "wouter";
import { type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
import { isCustodyOnly } from "@/lib/roles/experience-model";

type Props = { children: ReactNode; fallback?: string };

/**
 * Gates surfaces OUTSIDE the custody-only scope from custody-only users (the
 * student archetype — checkout/checkin equipment + inventory only). A custody-only
 * user reaching one of these routes by DIRECT URL is redirected to `fallback`, so
 * the scope is consistent whether a route is reached via the nav (already pared by
 * `filterCustodyNav`) or the URL bar. Mirrors the inline student redirect the Tasks
 * page already does (Tasks.tsx). The SERVER stays the enforcement boundary for
 * mutations; this is UX consistency for VIEW routes. Mount INSIDE AuthGuard so auth
 * is resolved before the role check.
 */
export function CustodyGuard({ children, fallback = "/equipment" }: Props) {
  const { isLoaded } = useAuth();
  const experience = useExperience();
  if (isLoaded && isCustodyOnly(experience)) {
    return <Redirect to={fallback} replace />;
  }
  return <>{children}</>;
}
