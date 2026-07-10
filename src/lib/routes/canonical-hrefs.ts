/** Canonical generated hrefs for migrated wedge surfaces. */
export const CANONICAL_HREFS = {
  // The real canonical routes (routes.tsx). The dashed `/equipment-board` and
  // `/equipment-tasks` paths are redirect aliases — pointing nav at them forced an
  // extra client redirect on every click and made active-state miss (the location
  // after redirect never equalled the alias href). Point straight at canonical (F10).
  equipmentBoard: "/equipment/board",
  equipmentTasks: "/equipment/tasks",
  locations: "/locations",
  criticalKitCheck: "/critical-kit-check",
  emergencyEquipmentLog: "/emergency-equipment-log",
  emergencyEquipmentWall: "/emergency-equipment-wall",
  emergencyEquipmentHistory: "/emergency-equipment-history",
} as const;
