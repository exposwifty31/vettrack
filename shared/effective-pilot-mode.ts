/**
 * Mainline builds ignore VITE_PILOT_MODE / PILOT_MODE unless ALLOW_EQUIPMENT_PILOT_MODE=true.
 * Railway service variables cannot override this via Dockerfile defaults alone.
 */
export function isEquipmentPilotBuildAllowed(): boolean {
  return process.env.ALLOW_EQUIPMENT_PILOT_MODE === "true";
}

/** Effective compile-time pilot flag (Vite bundle). */
export function resolveEffectiveVitePilotMode(): boolean {
  return isEquipmentPilotBuildAllowed() && process.env.VITE_PILOT_MODE === "true";
}

/** Effective runtime pilot flag (Express route registration). */
export function resolveEffectiveRuntimePilotMode(): boolean {
  return isEquipmentPilotBuildAllowed() && process.env.PILOT_MODE === "true";
}
