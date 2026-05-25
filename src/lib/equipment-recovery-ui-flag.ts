/** Opt-in rollout gate for equipment recovery read UI (R3+). Default off. */
export const isEquipmentRecoveryUiEnabled =
  import.meta.env.VITE_EQUIPMENT_RECOVERY_UI === "true";
