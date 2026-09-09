import { useExperience } from "@/hooks/use-experience";
import { usePlatformTarget } from "@/app/platform";

/**
 * Whether the current viewer may act without an active roster shift — the single
 * input to `shouldBlockForShift({ canActOffShift })` across every call site.
 *
 * Two capabilities, deliberately not merged:
 *  - `equipment.actOffShift` (admin, vet) exempts everywhere, unchanged.
 *  - `management.actOffShift` (admin, lead, secondary admin) exempts ONLY on the web
 *    management console. `lead` reaches that console but keeps the field roster gate
 *    on mobile/native, which is why widening the first capability was rejected.
 *
 * The scope test is the platform TARGET, not the viewport width: a native iPad is
 * wide enough that `useIsDesktop()` is true while `usePlatformTarget()` correctly
 * reports `mobile`, so gating on width would relax the roster gate inside the native
 * app. This stays client UX policy either way — the server is the enforcement
 * boundary and does not roster-deny scan/checkout.
 */
export function useCanActOffShift(): boolean {
  const { can } = useExperience();
  const target = usePlatformTarget();
  if (can("equipment.actOffShift")) return true;
  return target === "desktop" && can("management.actOffShift");
}
