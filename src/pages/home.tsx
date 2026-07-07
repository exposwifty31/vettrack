import { useIsNativeTablet } from "@/native/tablet/useIsNativeTablet";
import { useExperience } from "@/hooks/use-experience";
import { HomeTabletDashboard } from "@/features/today/HomeTabletDashboard";
import { OpsHomeSurface } from "@/features/today/surfaces/OpsHomeSurface";
import { FloorHomeSurface } from "@/features/today/surfaces/FloorHomeSurface";

/**
 * Home fork (Phase 3 / A2). Two axes decide which surface renders:
 *  - homeSurface (permanent-role-derived): ops (admin/lead) vs floor (vet/tech/student)
 *  - isNativeTablet: iPad-native composition vs phone/desktop-web
 *
 * Both hooks are called UNCONDITIONALLY at the top, then the body is pure component
 * selection (nested ternary — no early return, no post-branch hook). A runtime flip
 * of either predicate (iPad Split View resize; role refresh) swaps which surface
 * subtree mounts with a fresh, stable hook scope — the M3 invariant. iPad-native ops
 * keeps the existing HomeTabletDashboard; floor is one responsive surface for all form
 * factors (bare inside NativeShell on iPad).
 */
export default function HomePage() {
  const isNativeTablet = useIsNativeTablet();
  const { homeSurface } = useExperience();

  return homeSurface === "ops" ? (
    isNativeTablet ? (
      <HomeTabletDashboard />
    ) : (
      <OpsHomeSurface />
    )
  ) : (
    <FloorHomeSurface isTablet={isNativeTablet} />
  );
}
