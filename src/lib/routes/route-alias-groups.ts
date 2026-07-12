/**
 * Legacy-href → canonical-href groupings. Every route in a group renders the
 * SAME component in routes.tsx (mounted directly, not redirected) — nav-active
 * matching and CANONICAL_HREFS treat the group as one destination. `[0]` is
 * always the CANONICAL_HREFS value; the rest are legacy paths kept live for
 * bookmark/deep-link stability (e.g. `emergencyEquipmentWall[1]`, `/code-blue/display`,
 * intentionally renders the identical CodeBlueDisplay as the canonical
 * `/emergency-equipment-wall` — confirmed intent, not an unbuilt distinct wall).
 */
export const ROUTE_ALIAS_GROUPS = {
  equipmentBoard: ["/equipment/board", "/equipment-board", "/display"],
  equipmentTasks: ["/equipment/tasks", "/equipment-tasks", "/appointments"],
  locations: ["/locations", "/rooms"],
  criticalKitCheck: ["/critical-kit-check", "/crash-cart"],
  emergencyEquipmentLog: ["/emergency-equipment-log", "/code-blue"],
  emergencyEquipmentWall: ["/emergency-equipment-wall", "/code-blue/display"],
  emergencyEquipmentHistory: [
    "/emergency-equipment-history",
    "/admin/code-blue-history",
  ],
} as const;

export type RouteAliasGroupId = keyof typeof ROUTE_ALIAS_GROUPS;
