import { matchesRouteFamily } from "./matches-route-family.js";
import { ROUTE_ALIAS_GROUPS } from "./route-alias-groups.js";
import { normalizePathname } from "./normalize-pathname.js";

const HREF_TO_ALIAS_GROUP = new Map<string, readonly string[]>();
for (const routes of Object.values(ROUTE_ALIAS_GROUPS)) {
  for (const href of routes) {
    HREF_TO_ALIAS_GROUP.set(href, routes);
  }
}

const EQUIPMENT_BOARD_ROUTES = [
  "/equipment/board",
  "/equipment-board",
  "/display",
] as const;

const EMERGENCY_NAV_ROUTES = [
  "/code-blue",
  "/emergency-equipment-log",
  "/emergency-equipment-wall",
  "/code-blue/display",
] as const;

/** Equipment list hub: list, new, tasks, and detail — not the ward board. */
function isEquipmentNavActive(location: string): boolean {
  const path = normalizePathname(location);
  if (matchesRouteFamily(location, EQUIPMENT_BOARD_ROUTES)) return false;
  if (path === "/equipment") return true;
  if (path === "/equipment/new" || path.startsWith("/equipment/tasks")) return true;
  if (/^\/equipment\/[^/]+$/.test(path)) return true;
  return false;
}

/** Active nav state for canonical or legacy href within the same alias family. */
export function resolveNavItemActive(location: string, href: string): boolean {
  if (href === "/equipment") {
    return isEquipmentNavActive(location);
  }
  if (href === "/code-blue") {
    return matchesRouteFamily(location, EMERGENCY_NAV_ROUTES);
  }
  const aliasRoutes = HREF_TO_ALIAS_GROUP.get(href);
  if (aliasRoutes) {
    return matchesRouteFamily(location, aliasRoutes);
  }
  return normalizePathname(location) === normalizePathname(href);
}
