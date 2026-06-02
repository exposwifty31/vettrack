import { matchesRouteFamily } from "./matches-route-family.js";
import { ROUTE_ALIAS_GROUPS } from "./route-alias-groups.js";
import { normalizePathname } from "./normalize-pathname.js";

const HREF_TO_ALIAS_GROUP = new Map<string, readonly string[]>();
for (const routes of Object.values(ROUTE_ALIAS_GROUPS)) {
  for (const href of routes) {
    HREF_TO_ALIAS_GROUP.set(href, routes);
  }
}

/** Active nav state for canonical or legacy href within the same alias family. */
export function resolveNavItemActive(location: string, href: string): boolean {
  const aliasRoutes = HREF_TO_ALIAS_GROUP.get(href);
  if (aliasRoutes) {
    return matchesRouteFamily(location, aliasRoutes);
  }
  return normalizePathname(location) === normalizePathname(href);
}
