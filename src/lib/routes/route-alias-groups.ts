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
