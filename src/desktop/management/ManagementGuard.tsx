import type { ReactNode } from "react";
import { useExperience } from "@/hooks/use-experience";
import { AppShell } from "@/components/layout/AppShell";
import { ManagementAccessDenied } from "./ManagementAccessDenied";

/**
 * Capability gate for the web management console (Phase 6). Mount INSIDE
 * `AuthGuard` + `WebOnlyGuard` (auth → platform → capability). Admits admin, lead,
 * and secondary-admin (`management.web`); everyone else sees the shared explicit
 * "not authorized" state (T22 — this used to silently redirect home via wouter,
 * which was one of three divergent management-surface denial patterns; see
 * `ManagementAccessDenied` for the full list this now replaces).
 *
 * Do NOT hard-gate on `role === "admin"` — that would exclude lead, who is a
 * first-class read-only console user (I.4). Server stays the enforcement boundary.
 */
export function ManagementGuard({ children }: { children: ReactNode }) {
  const experience = useExperience();
  if (!experience.can("management.web")) {
    return (
      <AppShell>
        <ManagementAccessDenied />
      </AppShell>
    );
  }
  return <>{children}</>;
}
