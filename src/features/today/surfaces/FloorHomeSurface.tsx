import { useExperience } from "@/hooks/use-experience";
import { VetHomeSurface } from "./VetHomeSurface";
import { TechHomeSurface } from "./TechHomeSurface";
import { StudentHomeSurface } from "./StudentHomeSurface";

/**
 * Floor home DISPATCHER (Phase 8). `home.tsx` still forks only ops vs floor; this
 * layer differentiates the three FLOOR archetypes onto their own surfaces. It is
 * PURELY COMPOSITIONAL: it keys LAYOUT/emphasis on the permanent `archetype`, never
 * a new capability, and each surface gates its affordances on EXISTING `can()`
 * grants — so no role can do anything today it could not do before. All three
 * surfaces share the one cache-deduped floor engine (`use-floor-home`), so a role
 * flip swaps composition, not data, and forwards the same `isTablet` prop (bare vs
 * AppShell wrapping). `archetype` is one of vet/tech/student here (home.tsx routes
 * the ops archetypes elsewhere); the `default` degrades to tech — the least-authority
 * floor read and the exact pre-Phase-8 behavior.
 */
export function FloorHomeSurface({ isTablet }: { isTablet: boolean }) {
  const { archetype } = useExperience();
  switch (archetype) {
    case "vet":
      return <VetHomeSurface isTablet={isTablet} />;
    case "student":
      return <StudentHomeSurface isTablet={isTablet} />;
    default:
      return <TechHomeSurface isTablet={isTablet} />;
  }
}
