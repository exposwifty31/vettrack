import { normalizePathname } from "./normalize-pathname.js";
import { ROUTE_ALIAS_GROUPS, type RouteAliasGroupId } from "./route-alias-groups.js";

/** Longest / most specific families first. */
export const ROUTE_FAMILY_MATCH_ORDER = [
  "emergencyEquipmentWall",
  "emergencyEquipmentHistory",
  "emergencyEquipmentLog",
  "equipmentBoard",
  "equipmentTasks",
  "criticalKitCheck",
  "locations",
] as const satisfies readonly RouteAliasGroupId[];

export type RouteFamilyId = (typeof ROUTE_FAMILY_MATCH_ORDER)[number];

/**
 * Resolves wedge route-family id from a pathname.
 * Internal duplicate slashes (e.g. /locations//123) return null — not canonical identity.
 */
export function resolveRouteFamilyId(pathnameInput: string): RouteFamilyId | null {
  const pathname = normalizePathname(pathnameInput);
  if (pathname.includes("//")) return null;

  for (const familyId of ROUTE_FAMILY_MATCH_ORDER) {
    const routes = ROUTE_ALIAS_GROUPS[familyId];
    const matched = routes.some((route) => {
      const normalizedRoute = normalizePathname(route);
      if (pathname === normalizedRoute) return true;
      return pathname.startsWith(`${normalizedRoute}/`);
    });
    if (matched) return familyId;
  }
  return null;
}
