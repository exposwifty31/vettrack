/** Canonical generated hrefs for migrated wedge surfaces. */
export const CANONICAL_HREFS = {
  // The real canonical routes (routes.tsx). Point nav straight at canonical to avoid
  // an extra client redirect + active-state miss (F10). Phase 10: /board is the
  // single canonical Command Center; /equipment/board redirects to it, so nav goes
  // straight to /board (the BoardShell kiosk).
  equipmentBoard: "/board",
  equipmentTasks: "/equipment/tasks",
  locations: "/locations",
  criticalKitCheck: "/critical-kit-check",
  emergencyEquipmentLog: "/emergency-equipment-log",
  emergencyEquipmentWall: "/emergency-equipment-wall",
  emergencyEquipmentHistory: "/emergency-equipment-history",
} as const;
