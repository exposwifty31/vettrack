import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  buildRoleExperience,
  can as canCapability,
  type Capability,
  type RoleExperience,
} from "@/lib/roles/experience-model";

/**
 * The one React touchpoint for the role → experience model (Phase 2 / IV.2-A).
 *
 * Wraps `useAuth()` and exposes the derived {@link RoleExperience} plus a `can()`
 * helper. Consumers read UX shape from here instead of scattering `isAdmin` /
 * `role === "..."` checks. Enforcement stays server-side — `can()` is UX only.
 */
export interface UseExperienceResult extends RoleExperience {
  can: (capability: Capability) => boolean;
}

export function useExperience(): UseExperienceResult {
  const { role, effectiveRole, roleSource, isAdmin } = useAuth();
  return useMemo(() => {
    const experience = buildRoleExperience({ role, effectiveRole, roleSource, isAdmin });
    return { ...experience, can: (capability: Capability) => canCapability(experience, capability) };
  }, [role, effectiveRole, roleSource, isAdmin]);
}
