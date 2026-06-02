import { normalizePathname } from "./normalize-pathname.js";

/** Segment-aware route-family match (no naive prefix on unrelated paths). */
export function matchesRouteFamily(
  location: string,
  routes: readonly string[],
): boolean {
  const pathname = normalizePathname(location);
  return routes.some((route) => {
    const normalizedRoute = normalizePathname(route);
    if (pathname === normalizedRoute) return true;
    return pathname.startsWith(`${normalizedRoute}/`);
  });
}
